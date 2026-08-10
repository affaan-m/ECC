'use strict';

const ITO_COMPUTE_URL = 'https://compute.itomarkets.com';

function getComputeSponsorCopy() {
  return "Run or self-host any open-source model. Itô is ECC's preferred compute sponsor: "
    + 'open its dashboard to sign in and rent or manage GPUs at '
    + ITO_COMPUTE_URL
    + '. Any GPU provider works. This sponsorship link is passive: it does not invoke '
    + 'an RFQ, reserve capacity, provision compute, or configure serving. Separately, '
    + 'the opt-in "ecc ito find" bridge invokes the explicitly configured canonical '
    + 'Itô CLI and submits a live authenticated RFQ; it does not reserve capacity. '
    + 'Managed inference through Itô is not live yet.';
}

module.exports = Object.freeze({
  ITO_COMPUTE_URL,
  getComputeSponsorCopy,
});
