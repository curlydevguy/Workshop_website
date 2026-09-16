// register.html — fee summary + registration submit flow + payment proof submission.
// Talks to serverless functions:
//   POST /api/register       -> logs a row "awaiting_payment"
//   POST /api/submit-payment -> uploads screenshot to Drive & updates row with UTR + screenshot

(function () {
  const form = document.getElementById('regForm');
  const paymentProofForm = document.getElementById('paymentProofForm');
  if (!form && !paymentProofForm) return; // only runs on register page

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
  const showPaymentStepBtn = document.getElementById('showPaymentStepBtn');

  const paymentStep = document.getElementById('paymentStep');
  const paymentDueAmount = document.getElementById('paymentDueAmount');
  const paymentEmail = document.getElementById('paymentEmail');
  const paymentRef = document.getElementById('paymentRef');
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

  const BASE_FEE = 3000;

  function isWithStay() {
    return categorySelect && categorySelect.value !== 'without_accommodation';
  }

  // ---- Nights + fee math ----
  function nightsSelected() {
    if (!checkInDate || !checkOutDate) return 0;
    const inDay = Number(checkInDate.value);
    const outDay = Number(checkOutDate.value);
    const nights = outDay - inDay;
    return nights > 0 ? nights : 0;
  }

  function currentFee() {
    if (!categorySelect) return BASE_FEE;
    if (!isWithStay()) return BASE_FEE;
    const nights = nightsSelected();
    return BASE_FEE + nights * ACCOMMODATION_PER_NIGHT;
  }

  function syncCategoryFromDates() {
    if (!checkInDate || !checkOutDate || !categorySelect) return;
    const key = `with_accommodation_${checkInDate.value}_${checkOutDate.value}`;
    const matchingOpt = Array.from(categorySelect.options).find(o => o.value === key);
    if (matchingOpt) {
      categorySelect.value = key;
    }
  }

  function syncDatesFromCategory() {
    if (!categorySelect) return;
    const opt = categorySelect.options[categorySelect.selectedIndex];
    if (!opt) return;
    const inDay = opt.dataset.in;
    const outDay = opt.dataset.out;
    if (inDay && checkInDate) checkInDate.value = inDay;
    if (outDay && checkOutDate) checkOutDate.value = outDay;
  }

  function updateStayVisibility() {
    if (!categorySelect || !stayDatesRow) return;
    stayDatesRow.hidden = !isWithStay();
  }

  function updateFeeSummary() {
    if (!categorySelect || !feeSummary) return;
    const withStay = isWithStay();

    if (feeSummaryBaseAmount) feeSummaryBaseAmount.textContent = '₹' + BASE_FEE.toLocaleString('en-IN');

    if (withStay && feeSummaryStay && feeSummaryStayLabel && feeSummaryStayAmount) {
      const nights = nightsSelected();
      const stayAmount = nights * ACCOMMODATION_PER_NIGHT;
      feeSummaryStayLabel.textContent = 'Accommodation (' + nights + (nights === 1 ? ' night' : ' nights') + ' × ₹700)';
      feeSummaryStayAmount.textContent = '₹' + stayAmount.toLocaleString('en-IN');
      feeSummaryStay.hidden = false;
    } else if (feeSummaryStay) {
      feeSummaryStay.hidden = true;
    }

    const total = currentFee();
    if (feeSummaryAmount) feeSummaryAmount.textContent = total === null ? '₹0' : '₹' + total.toLocaleString('en-IN');
    feeSummary.hidden = false;
  }

  if (categorySelect) {
    categorySelect.addEventListener('change', () => {
      syncDatesFromCategory();
      updateStayVisibility();
      updateFeeSummary();
    });
  }

  if (checkInDate) {
    checkInDate.addEventListener('change', () => {
      syncCategoryFromDates();
      updateFeeSummary();
    });
  }

  if (checkOutDate) {
    checkOutDate.addEventListener('change', () => {
      syncCategoryFromDates();
      updateFeeSummary();
    });
  }

  // Initial sync
  updateStayVisibility();
  updateFeeSummary();

  function showError(message) {
    if (!formError) return;
    formError.textContent = message;
    formError.hidden = false;
  }

  function clearError() {
    if (!formError) return;
    formError.hidden = true;
    formError.textContent = '';
  }

  function setLoading(isLoading) {
    if (!payBtn) return;
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

  function revealPaymentStep(fee) {
    if (!paymentStep) return;
    if (fee && paymentDueAmount) paymentDueAmount.textContent = '₹' + fee.toLocaleString('en-IN');
    paymentStep.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => paymentStep.classList.add('is-visible'));
    });
  }

  // Handle Step 1 submission
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();

      const fee = currentFee();
      if (!form.reportValidity()) return;
      if (fee === null) {
        showError('Please select a registration category.');
        return;
      }
      if (isWithStay() && nightsSelected() <= 0) {
        showError('Please choose a valid stay date range (Check-in 19 or 20 Dec, Check-out 24 or 25 Dec).');
        return;
      }

      const rawEmail = document.getElementById('email').value.trim();
      const cleanEmail = rawEmail.toLowerCase();
      const withStay = isWithStay();

      const payload = {
        fullName: document.getElementById('fullName').value.trim(),
        email: cleanEmail,
        phone: document.getElementById('phone').value.trim(),
        institute: document.getElementById('institute').value.trim(),
        category: categorySelect.value,
        checkInDate: withStay ? checkInDate.value : '',
        checkOutDate: withStay ? checkOutDate.value : '',
        amount: fee,
      };

      setLoading(true);

      try {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Could not submit your registration. Please try again.');
      } catch (err) {
        setLoading(false);
        showError(err.message || 'Something went wrong submitting your registration. Please try again.');
        return;
      }

      // Persist email & fee across tabs and reloads
      submittedEmail = cleanEmail;
      try {
        sessionStorage.setItem('workshop_reg_email', cleanEmail);
        localStorage.setItem('workshop_reg_email', cleanEmail);
        sessionStorage.setItem('workshop_reg_fee', String(fee));
        localStorage.setItem('workshop_reg_fee', String(fee));
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '/register?step=payment&email=' + encodeURIComponent(cleanEmail));
        }
      } catch (storageErr) {}

      if (paymentEmail) paymentEmail.value = cleanEmail;

      const sName = document.getElementById('successName');
      const sEmail = document.getElementById('successEmail');
      if (sName) sName.textContent = payload.fullName;
      if (sEmail) sEmail.textContent = cleanEmail;

      form.hidden = true;
      if (regSuccess) regSuccess.hidden = false;

      revealPaymentStep(fee);

      if (regSuccess) regSuccess.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setLoading(false);
    });
  }

  // Restore state from URL or storage if returning user
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const paramEmail = urlParams.get('email');
    const paramStep = urlParams.get('step');

    const storedEmail = paramEmail || sessionStorage.getItem('workshop_reg_email') || localStorage.getItem('workshop_reg_email');
    const storedFee = Number(sessionStorage.getItem('workshop_reg_fee') || localStorage.getItem('workshop_reg_fee') || 3000);

    if (storedEmail) {
      submittedEmail = storedEmail.trim().toLowerCase();
      if (paymentEmail) paymentEmail.value = submittedEmail;
    }

    if (paramStep === 'payment' || (paramEmail && storedEmail)) {
      if (form) form.hidden = true;
      if (regSuccess) {
        regSuccess.hidden = false;
        const sEmail = document.getElementById('successEmail');
        if (sEmail) sEmail.textContent = submittedEmail;
      }
      revealPaymentStep(storedFee);
    }
  } catch (e) {}

  if (showPaymentStepBtn) {
    showPaymentStepBtn.addEventListener('click', () => {
      if (form) form.hidden = true;
      const storedFee = Number(sessionStorage.getItem('workshop_reg_fee') || localStorage.getItem('workshop_reg_fee') || 3000);
      revealPaymentStep(storedFee);
      if (paymentStep) paymentStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        showPaymentError('That file is too large. Please upload a screenshot or PDF under 4 MB.');
        paymentScreenshotInput.value = '';
        return;
      }
      clearPaymentError();
      if (paymentScreenshotFileName) paymentScreenshotFileName.textContent = file.name;
      if (paymentScreenshotEmpty) paymentScreenshotEmpty.hidden = true;
      if (paymentScreenshotFilled) paymentScreenshotFilled.hidden = false;
      if (paymentScreenshotDrop) paymentScreenshotDrop.classList.add('has-file');
    });
  }

  // Handle Step 3 payment proof submission
  if (paymentProofForm) {
    paymentProofForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearPaymentError();

      if (!paymentProofForm.reportValidity()) return;

      const emailInputVal = (paymentEmail ? paymentEmail.value : submittedEmail || '').trim().toLowerCase();
      if (!emailInputVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInputVal)) {
        showPaymentError('Please enter the email address you used during registration.');
        if (paymentEmail) paymentEmail.focus();
        return;
      }

      const refVal = (paymentRef ? paymentRef.value : '').trim();
      if (!refVal) {
        showPaymentError('Please enter your SBI Collect reference / UTR number.');
        if (paymentRef) paymentRef.focus();
        return;
      }

      const screenshotFile = paymentScreenshotInput && paymentScreenshotInput.files[0];
      if (!screenshotFile) {
        showPaymentError('Please upload a screenshot or receipt PDF of your payment confirmation.');
        return;
      }
      if (screenshotFile.size > MAX_SCREENSHOT_BYTES) {
        showPaymentError('That file is too large. Please upload a screenshot under 4 MB.');
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
        email: emailInputVal,
        reference: refVal,
        screenshotBase64,
        screenshotFileName: screenshotFile.name,
      };

      let result;
      try {
        const res = await fetch('/api/submit-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(paymentPayload),
        });
        result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Could not submit your payment proof. Please try again.');
      } catch (err) {
        setPaymentLoading(false);
        showPaymentError(err.message || 'Something went wrong submitting your payment proof. Please try again.');
        return;
      }

      try {
        sessionStorage.removeItem('workshop_reg_email');
      } catch (e) {}

      paymentProofForm.hidden = true;
      if (paymentSuccess) {
        paymentSuccess.hidden = false;
        if (result && result.screenshotUrl) {
          const linkWrap = document.getElementById('paymentScreenshotLinkWrap');
          const linkElem = document.getElementById('paymentScreenshotLink');
          if (linkWrap && linkElem) {
            linkElem.href = result.screenshotUrl;
            linkWrap.hidden = false;
          }
        }
        paymentSuccess.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      setPaymentLoading(false);
    });
  }
})();
