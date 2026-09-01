// register.html — fee summary + Razorpay checkout flow.
// Talks to two serverless functions:
//   POST /api/register  -> creates a pending row + a Razorpay order
//   POST /api/verify    -> verifies the payment signature, flips the row to "paid"

(function () {
  const form = document.getElementById('regForm');
  if (!form) return; // only runs on register.html

  const categorySelect = document.getElementById('category');
  const feeSummary = document.getElementById('feeSummary');
  const feeSummaryAmount = document.getElementById('feeSummaryAmount');
  const payBtn = document.getElementById('payBtn');
  const formError = document.getElementById('formError');
  const regSuccess = document.getElementById('regSuccess');
  const idProofInput = document.getElementById('idProof');
  const idProofSelected = document.getElementById('idProofSelected');

  const MAX_ID_PROOF_BYTES = 4 * 1024 * 1024; // 4 MB — keep serverless request bodies small

  // ---- Show the chosen filename so people know their upload registered ----
  if (idProofInput) {
    idProofInput.addEventListener('change', () => {
      const file = idProofInput.files[0];
      if (!file) {
        idProofSelected.hidden = true;
        return;
      }
      if (file.size > MAX_ID_PROOF_BYTES) {
        idProofSelected.hidden = true;
        showError('That ID proof file is too large. Please upload a file under 4 MB.');
        idProofInput.value = '';
        return;
      }
      clearError();
      idProofSelected.textContent = 'Selected: ' + file.name;
      idProofSelected.hidden = false;
    });
  }

  // ---- Read the chosen file as a base64 data URL for upload ----
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the selected file. Please try again.'));
      reader.readAsDataURL(file);
    });
  }

  // ---- Live fee display, driven by the selected option's data-fee ----
  function currentFee() {
    const opt = categorySelect.options[categorySelect.selectedIndex];
    const fee = opt ? Number(opt.dataset.fee) : NaN;
    return Number.isFinite(fee) ? fee : null;
  }

  categorySelect.addEventListener('change', () => {
    const fee = currentFee();
    if (fee === null) {
      feeSummary.hidden = true;
      return;
    }
    feeSummaryAmount.textContent = '₹' + fee.toLocaleString('en-IN');
    feeSummary.hidden = false;
  });

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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const fee = currentFee();
    if (!form.reportValidity()) return;
    if (fee === null) {
      showError('Please select a registration category.');
      return;
    }

    const idProofFile = idProofInput && idProofInput.files[0];
    if (!idProofFile) {
      showError('Please upload a photo of your college ID card showing your roll number.');
      return;
    }
    if (idProofFile.size > MAX_ID_PROOF_BYTES) {
      showError('That ID proof file is too large. Please upload a file under 4 MB.');
      return;
    }

    const payload = {
      fullName: document.getElementById('fullName').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      institute: document.getElementById('institute').value.trim(),
      category: categorySelect.value,
    };

    setLoading(true);

    try {
      payload.idProofBase64 = await readFileAsBase64(idProofFile);
      payload.idProofFileName = idProofFile.name;
      payload.idProofMimeType = idProofFile.type;
    } catch (err) {
      setLoading(false);
      showError(err.message || 'Could not read the ID proof file. Please try again.');
      return;
    }

    let order;
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      order = await res.json();
      if (!res.ok) throw new Error(order.error || 'Could not start registration. Please try again.');
    } catch (err) {
      setLoading(false);
      showError(err.message || 'Something went wrong starting your registration. Please try again.');
      return;
    }

    // ---- Open Razorpay checkout with the order we just created ----
    const rzp = new Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency || 'INR',
      order_id: order.orderId,
      name: 'AI for Secure 6G: Foundations of FL, XAI, and LLMs',
      description: 'Registration fee — ' + categorySelect.options[categorySelect.selectedIndex].text,
      prefill: {
        name: payload.fullName,
        email: payload.email,
        contact: payload.phone,
      },
      theme: { color: '#2563eb' },
      handler: async function (response) {
        // Payment succeeded at the gateway — now verify server-side before
        // treating the registration as confirmed.
        try {
          const verifyRes = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              email: payload.email,
            }),
          });
          const verifyData = await verifyRes.json();
          if (!verifyRes.ok || !verifyData.verified) {
            throw new Error(verifyData.error || 'Payment could not be verified.');
          }

          document.getElementById('successName').textContent = payload.fullName;
          document.getElementById('successEmail').textContent = payload.email;
          document.getElementById('successPaymentId').textContent = response.razorpay_payment_id;
          form.hidden = true;
          regSuccess.hidden = false;
          regSuccess.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
          setLoading(false);
          showError(
            (err.message || 'We could not verify your payment automatically.') +
            ' If the amount was debited, please contact us via the Contact page with your payment reference before retrying.'
          );
        }
      },
      modal: {
        ondismiss: function () {
          // User closed the checkout without paying — just re-enable the form.
          setLoading(false);
        },
      },
    });

    rzp.on('payment.failed', function (response) {
      setLoading(false);
      showError('Payment failed: ' + (response.error && response.error.description ? response.error.description : 'please try again.'));
    });

    setLoading(false);
    rzp.open();
  });
})();
