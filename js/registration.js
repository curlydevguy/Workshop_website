// register.html — fee summary + registration submit flow.
// Talks to one serverless function:
//   POST /api/register  -> logs a row "awaiting payment" (no gateway right
//   now — payment instructions via SBI Collect are shared separately)
//
// Fee model (2 categories only):
//   without_accommodation -> flat ₹3,000
//   with_accommodation    -> ₹3,000 + (nights × ₹700), nights = checkout day - checkin day
//                             (check-in 19–24 Dec, check-out 20–25 Dec)

(function () {
  const form = document.getElementById('regForm');
  if (!form) return; // only runs on register.html

  const ACCOMMODATION_PER_NIGHT = 700;

  const categorySelect = document.getElementById('category');
  const stayDatesRow = document.getElementById('stayDatesRow');
  const checkInDate = document.getElementById('checkInDate');
  const checkOutDate = document.getElementById('checkOutDate');

  const feeSummary = document.getElementById('feeSummary');
  const feeSummaryAmount = document.getElementById('feeSummaryAmount');
  const feeSummaryBaseAmount = document.getElementById('feeSummaryBaseAmount');
  const feeSummaryStay = document.getElementById('feeSummaryStay');
  const feeSummaryStayLabel = document.getElementById('feeSummaryStayLabel');
  const feeSummaryStayAmount = document.getElementById('feeSummaryStayAmount');

  const payBtn = document.getElementById('payBtn');
  const formError = document.getElementById('formError');
  const regSuccess = document.getElementById('regSuccess');

  // ---- Nights + fee math ----
  function nightsSelected() {
    const inDay = Number(checkInDate.value);
    const outDay = Number(checkOutDate.value);
    const nights = outDay - inDay;
    return nights > 0 ? nights : 0;
  }

  function currentFee() {
    const opt = categorySelect.options[categorySelect.selectedIndex];
    const baseFee = opt ? Number(opt.dataset.fee) : NaN;
    if (!Number.isFinite(baseFee)) return null;

    if (categorySelect.value === 'with_accommodation') {
      const nights = nightsSelected();
      return baseFee + nights * ACCOMMODATION_PER_NIGHT;
    }
    return baseFee;
  }

  function updateStayVisibility() {
    const withStay = categorySelect.value === 'with_accommodation';
    stayDatesRow.hidden = !withStay;
  }

  function updateFeeSummary() {
    const opt = categorySelect.options[categorySelect.selectedIndex];
    const baseFee = opt ? Number(opt.dataset.fee) : NaN;
    const withStay = categorySelect.value === 'with_accommodation';

    if (!Number.isFinite(baseFee)) {
      feeSummary.hidden = true;
      return;
    }

    feeSummaryBaseAmount.textContent = '₹' + baseFee.toLocaleString('en-IN');

    if (withStay) {
      const nights = nightsSelected();
      const stayAmount = nights * ACCOMMODATION_PER_NIGHT;
      feeSummaryStayLabel.textContent = 'Accommodation (' + nights + (nights === 1 ? ' night' : ' nights') + ' × ₹700)';
      feeSummaryStayAmount.textContent = '₹' + stayAmount.toLocaleString('en-IN');
      feeSummaryStay.hidden = false;
    } else {
      feeSummaryStay.hidden = true;
    }

    const total = currentFee();
    feeSummaryAmount.textContent = total === null ? '₹0' : '₹' + total.toLocaleString('en-IN');
    feeSummary.hidden = false;
  }

  categorySelect.addEventListener('change', () => {
    updateStayVisibility();
    updateFeeSummary();
  });
  checkInDate.addEventListener('change', () => {
    // Keep check-out always after check-in — nudge it forward if needed.
    if (Number(checkOutDate.value) <= Number(checkInDate.value)) {
      const nextOption = Array.from(checkOutDate.options).find(o => Number(o.value) > Number(checkInDate.value));
      if (nextOption) checkOutDate.value = nextOption.value;
    }
    updateFeeSummary();
  });
  checkOutDate.addEventListener('change', updateFeeSummary);

  // Sync on load.
  updateStayVisibility();
  updateFeeSummary();

  function showError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  function clearError() {
    formError.hidden = true;
    formError.textContent = '';
  }

  function setLoading(isLoading) {
    payBtn.disabled = isLoading;
    payBtn.classList.toggle('is-loading', isLoading);
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the selected file. Please try again.'));
      reader.readAsDataURL(file);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const fee = currentFee();
    if (!form.reportValidity()) return;
    if (fee === null) {
      showError('Please select a registration category.');
      return;
    }
    if (categorySelect.value === 'with_accommodation' && nightsSelected() <= 0) {
      showError('Please choose a check-out date after your check-in date.');
      return;
    }

    const payload = {
      fullName: document.getElementById('fullName').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      institute: document.getElementById('institute').value.trim(),
      category: categorySelect.value,
      checkInDate: categorySelect.value === 'with_accommodation' ? checkInDate.value : '',
      checkOutDate: categorySelect.value === 'with_accommodation' ? checkOutDate.value : '',
      amount: fee,
    };

    setLoading(true);

    let result;
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not submit your registration. Please try again.');
    } catch (err) {
      setLoading(false);
      showError(err.message || 'Something went wrong submitting your registration. Please try again.');
      return;
    }

    // No payment gateway right now — registration is logged as "awaiting
    // payment". The payment step (SBI Collect link + proof-of-payment form)
    // reveals itself right below, so the participant can complete it in the
    // same visit instead of waiting for a separate email.
    document.getElementById('successName').textContent = payload.fullName;
    document.getElementById('successEmail').textContent = payload.email;
    form.hidden = true;
    regSuccess.hidden = false;

    submittedEmail = payload.email;
    revealPaymentStep(fee);

    regSuccess.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setLoading(false);
  });

  // ==========================================================================
  // PAYMENT STEP — appears once registration succeeds. Pay via SBI Collect,
  // then submit proof of payment (reference number, amount, date, screenshot).
  // ==========================================================================
  const paymentStep = document.getElementById('paymentStep');
  const paymentDueAmount = document.getElementById('paymentDueAmount');
  const paymentProofForm = document.getElementById('paymentProofForm');
  const paymentFormError = document.getElementById('paymentFormError');
  const paymentSubmitBtn = document.getElementById('paymentSubmitBtn');
  const paymentSuccess = document.getElementById('paymentSuccess');
  const paymentScreenshotInput = document.getElementById('paymentScreenshot');
  const paymentScreenshotDrop = document.getElementById('paymentScreenshotDrop');
  const paymentScreenshotEmpty = document.getElementById('paymentScreenshotEmpty');
  const paymentScreenshotFilled = document.getElementById('paymentScreenshotFilled');
  const paymentScreenshotFileName = document.getElementById('paymentScreenshotFileName');

  const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024; // 4 MB
  let submittedEmail = null;

  // Reveal the payment step — unhide it, then add the "is-visible" class a
  // tick later so the .reveal-pop transition (fade + slide up) actually
  // plays instead of snapping straight to its final state.
  function revealPaymentStep(fee) {
    if (!paymentStep) return;
    if (fee) paymentDueAmount.textContent = '₹' + fee.toLocaleString('en-IN');
    paymentStep.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => paymentStep.classList.add('is-visible'));
    });
  }

  function showPaymentError(message) {
    if (!paymentFormError) return;
    paymentFormError.textContent = message;
    paymentFormError.hidden = false;
  }

  function clearPaymentError() {
    if (!paymentFormError) return;
    paymentFormError.hidden = true;
    paymentFormError.textContent = '';
  }

  function setPaymentLoading(isLoading) {
    if (!paymentSubmitBtn) return;
    paymentSubmitBtn.disabled = isLoading;
    paymentSubmitBtn.classList.toggle('is-loading', isLoading);
  }

  if (paymentScreenshotInput) {
    paymentScreenshotInput.addEventListener('change', () => {
      const file = paymentScreenshotInput.files[0];
      if (!file) return;
      if (file.size > MAX_SCREENSHOT_BYTES) {
        showPaymentError('That screenshot is too large. Please upload a file under 4 MB.');
        paymentScreenshotInput.value = '';
        return;
      }
      clearPaymentError();
      paymentScreenshotFileName.textContent = file.name;
      paymentScreenshotEmpty.hidden = true;
      paymentScreenshotFilled.hidden = false;
      paymentScreenshotDrop.classList.add('has-file');
    });
  }

  if (paymentProofForm) {
    paymentProofForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearPaymentError();

      if (!paymentProofForm.reportValidity()) return;

      const screenshotFile = paymentScreenshotInput && paymentScreenshotInput.files[0];
      if (!screenshotFile) {
        showPaymentError('Please upload a screenshot of your payment confirmation.');
        return;
      }
      if (screenshotFile.size > MAX_SCREENSHOT_BYTES) {
        showPaymentError('That screenshot is too large. Please upload a file under 4 MB.');
        return;
      }
      if (!submittedEmail) {
        showPaymentError('We lost track of your registration email — please refresh and register again.');
        return;
      }

      setPaymentLoading(true);

      let screenshotBase64;
      try {
        screenshotBase64 = await readFileAsBase64(screenshotFile);
      } catch (err) {
        setPaymentLoading(false);
        showPaymentError(err.message || 'Could not read the screenshot file. Please try again.');
        return;
      }

      const paymentPayload = {
        email: submittedEmail,
        reference: document.getElementById('paymentRef').value.trim(),
        screenshotBase64,
        screenshotFileName: screenshotFile.name,
      };

      try {
        const res = await fetch('/api/submit-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(paymentPayload),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Could not submit your payment proof. Please try again.');
      } catch (err) {
        setPaymentLoading(false);
        showPaymentError(err.message || 'Something went wrong submitting your payment proof. Please try again.');
        return;
      }

      paymentProofForm.hidden = true;
      paymentSuccess.hidden = false;
      paymentSuccess.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPaymentLoading(false);
    });
  }
})();
