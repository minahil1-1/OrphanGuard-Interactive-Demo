const menuToggle = document.querySelector('.menu-toggle');
const primaryNav = document.getElementById('primary-nav');

if (menuToggle && primaryNav) {
  menuToggle.addEventListener('click', function () {
    const open = primaryNav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.textContent = open ? 'Close' : 'Menu';
  });
  primaryNav.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      primaryNav.classList.remove('open');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.textContent = 'Menu';
    });
  });
}

const flowDialog = document.getElementById('flow-dialog');
const startReview = document.getElementById('start-review');
const nextFlow = document.getElementById('next-flow');
const resetFlow = document.getElementById('reset-flow');
const closeDialog = document.querySelector('.dialog-close');
const dialogSteps = Array.from(document.querySelectorAll('#dialog-steps li'));
const dialogFeedback = document.getElementById('dialog-feedback');
const reviewComplete = document.getElementById('review-complete');
let flowStep = 0;

function renderFlow() {
  dialogSteps.forEach(function (step, index) {
    step.classList.toggle('current', index === flowStep);
    step.classList.toggle('done', index < flowStep);
  });
  dialogFeedback.textContent = flowStep < dialogSteps.length
    ? 'Step ' + (flowStep + 1) + ' of 3 · concept only'
    : 'Walkthrough complete · no case was created or sent';
  nextFlow.innerHTML = flowStep < dialogSteps.length - 1
    ? 'Continue <span aria-hidden="true">→</span>'
    : flowStep === dialogSteps.length - 1
      ? 'Finish sample flow <span aria-hidden="true">✓</span>'
      : 'Close walkthrough';
  reviewComplete.hidden = flowStep < dialogSteps.length;
}

if (startReview && flowDialog) {
  startReview.addEventListener('click', function () {
    flowStep = 0;
    renderFlow();
    flowDialog.showModal();
  });
}

if (nextFlow) {
  nextFlow.addEventListener('click', function () {
    if (flowStep < dialogSteps.length) flowStep += 1;
    if (flowStep > dialogSteps.length) flowDialog.close();
    renderFlow();
  });
}

if (resetFlow) {
  resetFlow.addEventListener('click', function () {
    flowStep = 0;
    renderFlow();
  });
}

if (closeDialog) closeDialog.addEventListener('click', function () { flowDialog.close(); });

if (flowDialog) {
  flowDialog.addEventListener('click', function (event) {
    if (event.target === flowDialog) flowDialog.close();
  });
}

renderFlow();
