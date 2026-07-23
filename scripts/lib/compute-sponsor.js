'use strict';

const ITO_COMPUTE_URL = 'https://compute.itomarkets.com';

function getComputeSponsorCopy() {
  return "Run or self-host any open-source model. Itô is ECC's preferred compute sponsor: "
    + 'open its dashboard to sign in and rent or manage GPUs at '
    + ITO_COMPUTE_URL
    + '. Any GPU provider works. ECC only provides this link; it does not provision '
    + 'compute or serving. Managed inference through Itô is not live yet.';
}

module.exports = Object.freeze({
  ITO_COMPUTE_URL,
  getComputeSponsorCopy,
});
