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
  const idProofRow = document.getElementById('idProofRow');
  const idProofDrop = document.getElementById('idProofDrop');
  const idProofEmpty = document.getElementById('idProofEmpty');
  const idProofFilled = document.getElementById('idProofFilled');
  const idProofFileName = document.getElementById('idProofFileName');
  const idProofCheckStatus = document.getElementById('idProofCheckStatus');

  const instituteInput = document.getElementById('institute');
  const instituteRow = document.getElementById('instituteRow');
  const categoryHint = document.getElementById('categoryHint');
  const emailInput = document.getElementById('email');
  const iitrVerifyBlock = document.getElementById('iitrVerifyBlock');
  const sendOtpBtn = document.getElementById('sendOtpBtn');
  const emailVerifyStatus = document.getElementById('emailVerifyStatus');
  const otpRow = document.getElementById('otpRow');
  const otpInput = document.getElementById('otpInput');
  const verifyOtpBtn = document.getElementById('verifyOtpBtn');
  const otpStatus = document.getElementById('otpStatus');
  const resendOtpLink = document.getElementById('resendOtpLink');

  const MAX_ID_PROOF_BYTES = 4 * 1024 * 1024; // 4 MB — keep serverless request bodies small
  const IITR_DOMAIN = 'iitr.ac.in';

  // Accepts the main domain and any department subdomain:
  // someone@iitr.ac.in, someone@cs.iitr.ac.in, someone@ma.iitr.ac.in, etc.
  // Covers students, faculty, and researchers across all IITR departments.
  function isIitrEmail(email) {
    const domain = (email.split('@')[1] || '').toLowerCase();
    return domain === IITR_DOMAIN || domain.endsWith('.' + IITR_DOMAIN);
  }

  // ---- Email verification state (only relevant for @iitr.ac.in addresses) ----
  // challengeToken: proof a code was sent, needed to check what the user types back
  // verifiedToken: proof the email was actually confirmed, sent along at final submit
  let challengeToken = null;
  let verifiedToken = null;
  let verifiedEmail = null; // the exact IITR email the verifiedToken belongs to
  let autoSelectedCategory = false; // true if we auto-picked "iitr_student" for them
  let autoSelectedInstitute = false; // true if we auto-filled "IIT Roorkee" for them
  let idProofAiCheck = null; // { isValidId, reason } from /api/check-id-proof — advisory only, never blocks

  function resetVerification() {
    verifiedToken = null;
    verifiedEmail = null;
    challengeToken = null;
    otpRow.hidden = true;
    otpInput.value = '';
    emailVerifyStatus.hidden = true;
    sendOtpBtn.disabled = false;
    sendOtpBtn.hidden = false;
    sendOtpBtn.textContent = 'Send Code';
    otpStatus.textContent = '';
    verifyOtpBtn.disabled = false;
    verifyOtpBtn.textContent = 'Verify Code';
  }

  function clearIdProof() {
    idProofInput.value = '';
    idProofEmpty.hidden = false;
    idProofFilled.hidden = true;
    idProofDrop.classList.remove('has-file');
    idProofCheckStatus.hidden = true;
    idProofCheckStatus.className = '';
    idProofAiCheck = null;
  }

  function currentFee() {
    const opt = categorySelect.options[categorySelect.selectedIndex];
    const fee = opt ? Number(opt.dataset.fee) : NaN;
    return Number.isFinite(fee) ? fee : null;
  }

  function updateFeeSummary() {
    const fee = currentFee();
    if (fee === null) {
      feeSummary.hidden = true;
      return;
    }
    feeSummaryAmount.textContent = '₹' + fee.toLocaleString('en-IN');
    feeSummary.hidden = false;
  }

  // ---- Institute row only ever applies to the manual (non-IITR) path —
  // hidden until a category has actually been picked, and always hidden
  // while the category select itself is locked (no email yet, or IITR
  // auto-selected). ----
  function updateInstituteVisibility() {
    if (categorySelect.disabled) {
      instituteRow.hidden = true;
      instituteInput.required = false;
      return;
    }
    const hasCategory = !!categorySelect.value;
    instituteRow.hidden = !hasCategory;
    instituteInput.required = hasCategory;
    if (!hasCategory) instituteInput.value = '';
  }

  // ---- Core: react to the email field, live ----
  // Category stays locked until an email is typed. Typing an @iitr.ac.in
  // address auto-picks + locks the IITR student rate, keeps the institute
  // name filled internally (IIT Roorkee) but hidden, and reveals the OTP
  // verification block + College ID upload right below the email field.
  // Any other email unlocks the category dropdown for manual choice, and
  // reveals Institute/Organization once a category is actually picked.
  function handleEmailChange() {
    const email = emailInput.value.trim();
    const iitr = email && isIitrEmail(email);

    if (!email) {
      categorySelect.disabled = true;
      categorySelect.value = '';
      autoSelectedCategory = false;
      categoryHint.hidden = false;
      categoryHint.textContent = 'Enter your email address above to unlock this field.';
      updateFeeSummary();

      instituteRow.hidden = true;
      instituteInput.value = '';
      instituteInput.required = false;
      autoSelectedInstitute = false;

      iitrVerifyBlock.hidden = true;
      idProofRow.hidden = true;
      idProofInput.required = false;
      resetVerification();
      clearIdProof();
      return;
    }

    if (iitr) {
      iitrVerifyBlock.hidden = false;
      idProofRow.hidden = false;
      idProofInput.required = true;

      // Lock the category to the IITR rate — payment is still gated on
      // actually verifying the email via OTP at submit time.
      categorySelect.value = 'iitr_student';
      categorySelect.disabled = true;
      autoSelectedCategory = true;
      categoryHint.hidden = false;
      categoryHint.textContent = 'Auto-selected for your @iitr.ac.in address — verify your email below to continue.';
      updateFeeSummary();

      // Institute is known (IIT Roorkee) — keep the value, keep it hidden.
      instituteInput.value = 'IIT Roorkee';
      autoSelectedInstitute = true;
      instituteRow.hidden = true;
      instituteInput.required = false;

      if (verifiedEmail && email.toLowerCase() !== verifiedEmail) {
        resetVerification();
      }
    } else {
      iitrVerifyBlock.hidden = true;
      idProofRow.hidden = true;
      idProofInput.required = false;
      resetVerification();
      clearIdProof();

      // Unlock category for manual selection.
      categorySelect.disabled = false;
      categoryHint.hidden = true;
      if (autoSelectedCategory) {
        categorySelect.value = '';
        autoSelectedCategory = false;
      }
      updateFeeSummary();

      if (autoSelectedInstitute) {
        instituteInput.value = '';
        autoSelectedInstitute = false;
      }
      updateInstituteVisibility();
    }
  }

  // If the user edits the institute field manually, stop treating it as
  // "ours to overwrite" later.
  instituteInput.addEventListener('input', () => {
    autoSelectedInstitute = false;
  });

  emailInput.addEventListener('input', handleEmailChange);

  // If the user manually changes the category themselves, it's no longer
  // "auto-selected" — never touch the institute row unless the category
  // path allows it (locked/IITR path never shows it at all).
  categorySelect.addEventListener('change', () => {
    autoSelectedCategory = false;
    updateFeeSummary();
    updateInstituteVisibility();
  });

  // Sync everything once on load — covers browser autofill restoring a
  // previously-typed email before any 'input' event fires.
  handleEmailChange();

  async function requestOtp() {
    const email = emailInput.value.trim();
    if (!email || !emailInput.checkValidity()) {
      showError('Please enter a valid email address before requesting a code.');
      emailInput.focus();
      return;
    }
    if (!isIitrEmail(email)) {
      showError(`The verification code can only be sent to an @${IITR_DOMAIN} email address.`);
      emailInput.focus();
      return;
    }

    sendOtpBtn.disabled = true;
    sendOtpBtn.textContent = 'Sending...';
    clearError();

    try {
      const res = await fetch('/api/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send the verification code.');

      challengeToken = data.challengeToken;
      otpRow.hidden = false;
      otpStatus.textContent = 'Code sent — check your inbox (and spam folder).';
      otpInput.focus();
      sendOtpBtn.textContent = 'Code Sent';
    } catch (err) {
      showError(err.message || 'Could not send the verification code. Please try again.');
      sendOtpBtn.disabled = false;
      sendOtpBtn.textContent = 'Send Code';
    }
  }

  sendOtpBtn.addEventListener('click', requestOtp);
  resendOtpLink.addEventListener('click', (e) => {
    e.preventDefault();
    requestOtp();
  });

  // Only digits, and cap at 6 — also lets us reliably detect "a full code
  // was just typed/pasted" without guessing at partial input.
  otpInput.addEventListener('input', () => {
    const digitsOnly = otpInput.value.replace(/\D/g, '').slice(0, 6);
    if (digitsOnly !== otpInput.value) otpInput.value = digitsOnly;

    if (digitsOnly.length === 6 && !verifyOtpBtn.disabled) {
      verifyOtp(); // auto-verify — no click needed once all 6 digits are in
    }
  });

  verifyOtpBtn.addEventListener('click', verifyOtp);

  async function verifyOtp() {
    const email = emailInput.value.trim();
    const otp = otpInput.value.trim();

    if (!challengeToken) {
      otpStatus.textContent = 'Please request a code first.';
      return;
    }
    if (otp.length !== 6) {
      otpStatus.textContent = 'Please enter the 6-digit code from your email.';
      return;
    }

    verifyOtpBtn.disabled = true;
    verifyOtpBtn.textContent = 'Verifying...';
    otpStatus.textContent = 'Checking code...';

    try {
      const res = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, challengeToken }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified) throw new Error(data.error || 'That code is incorrect or expired.');

      verifiedToken = data.verifiedToken;
      verifiedEmail = email.toLowerCase();
      otpStatus.textContent = '';
      emailVerifyStatus.textContent = '✓ Email verified: ' + email;
      emailVerifyStatus.hidden = false;
      otpRow.hidden = true;
      sendOtpBtn.hidden = true;
      categoryHint.textContent = '✓ Verified — IIT Roorkee Student rate locked in.';
    } catch (err) {
      otpStatus.textContent = err.message || 'That code is incorrect or expired. Please try again.';
      verifyOtpBtn.disabled = false;
      verifyOtpBtn.textContent = 'Verify Code';
    }
  }

  // ---- Show the chosen filename (and a clear confirmed state) so people
  // know their upload actually registered, instead of the box just sitting
  // there looking unchanged ----
  if (idProofInput) {
    idProofInput.addEventListener('change', () => {
      const file = idProofInput.files[0];
      if (!file) {
        clearIdProof();
        return;
      }
      if (file.size > MAX_ID_PROOF_BYTES) {
        showError('That ID proof file is too large. Please upload a file under 4 MB.');
        clearIdProof();
        return;
      }
      clearError();
      idProofFileName.textContent = file.name;
      idProofEmpty.hidden = true;
      idProofFilled.hidden = false;
      idProofDrop.classList.add('has-file');

      runIdProofCheck(file);
    });
  }

  // ---- Advisory AI check: does this actually look like an ID card? ----
  // Runs automatically the moment a file is selected. Never blocks the
  // form — just shows a hint and tags the result for the admin to see in
  // the sheet later.
  async function runIdProofCheck(file) {
    idProofAiCheck = null;
    idProofCheckStatus.hidden = false;
    idProofCheckStatus.className = 'is-checking';
    idProofCheckStatus.textContent = 'Checking your ID card...';

    let base64;
    try {
      base64 = await readFileAsBase64(file);
    } catch (err) {
      idProofCheckStatus.hidden = true;
      return; // the actual submit-time read will surface this error properly
    }

    try {
      const res = await fetch('/api/check-id-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
      });
      const data = await res.json();
      idProofAiCheck = { isValidId: data.isValidId, reason: data.reason };

      if (data.isValidId === true) {
        idProofCheckStatus.className = 'is-ok';
        idProofCheckStatus.textContent = '✓ Looks like a valid ID card';
      } else if (data.isValidId === false) {
        idProofCheckStatus.className = 'is-warn';
        idProofCheckStatus.textContent = "⚠ This doesn't look like a clear ID card — you can still submit, but a blurry or wrong photo may need manual review.";
      } else {
        // isValidId === null: the check itself couldn't run (key missing,
        // API hiccup, etc). Never blocks submission, but DO show it — a
        // quiet failure here is otherwise invisible and impossible to debug.
        idProofCheckStatus.className = 'is-checking';
        idProofCheckStatus.textContent = 'Automatic check unavailable right now (' + (data.reason || 'unknown reason') + ') — you can still submit normally.';
      }
    } catch (err) {
      idProofCheckStatus.className = 'is-checking';
      idProofCheckStatus.textContent = 'Automatic check unavailable right now (could not reach the check endpoint) — you can still submit normally.';
    }
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

    if (categorySelect.value === 'iitr_student') {
      const emailNow = emailInput.value.trim().toLowerCase();
      if (!verifiedToken || verifiedEmail !== emailNow) {
        showError(`Please verify your @${IITR_DOMAIN} email address (click "Send Code") before proceeding to payment.`);
        return;
      }
    }

    const idProofFile = idProofInput && idProofInput.files[0];
    const idProofNeeded = !idProofRow.hidden;
    if (idProofNeeded && !idProofFile) {
      showError('Please upload a photo of your college ID card showing your roll number.');
      return;
    }
    if (idProofFile && idProofFile.size > MAX_ID_PROOF_BYTES) {
      showError('That ID proof file is too large. Please upload a file under 4 MB.');
      return;
    }

    const payload = {
      fullName: document.getElementById('fullName').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      institute: document.getElementById('institute').value.trim(),
      category: categorySelect.value,
      verifiedToken: categorySelect.value === 'iitr_student' ? verifiedToken : undefined,
      // Advisory only — the backend never rejects on this, it's just logged
      // to the sheet so a human can spot-check flagged uploads.
      idProofAiCheckResult: idProofAiCheck === null ? 'not_checked' : (idProofAiCheck.isValidId ? 'looks_valid' : 'flagged'),
      idProofAiCheckReason: idProofAiCheck ? idProofAiCheck.reason : '',
    };

    setLoading(true);

    if (idProofFile) {
      try {
        payload.idProofBase64 = await readFileAsBase64(idProofFile);
        payload.idProofFileName = idProofFile.name;
        payload.idProofMimeType = idProofFile.type;
      } catch (err) {
        setLoading(false);
        showError(err.message || 'Could not read the ID proof file. Please try again.');
        return;
      }
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
