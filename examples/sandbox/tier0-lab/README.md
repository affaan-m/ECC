# Tier 0 Interactive Lab

This lab treats the staged host tools as untrusted inside a restricted SRT
process boundary.
Invoke `ecc-sandbox` from this directory so the writable workspace is limited to
the lab instead of the full repository.

Inside the exploration terminal, run:

```bash
node ./producer.mjs | node ./consumer.mjs
node ./prove-isolation.js
printf 'safe workspace write\n' > ./scratch.txt && cat ./scratch.txt
cat ../tier0-host-canary.txt
curl --connect-timeout 2 https://example.com
test -z "${TIER0_HOST_SECRET-}" && printf 'host secret is absent\n'
```

Expected results:

- The producer and consumer communicate through a pipe.
- The proof script reports that workspace reads and writes succeed.
- Reading the sibling path fails with a permission error.
- Local endpoint binding fails with a permission error, so an HTTP or local TCP
  service is not the right Tier 0 primitive in this sandbox policy.
- External networking is blocked because the manifest grants no network domain.
- The environment contains a small operational allowlist and excludes host secrets.

Use Tier 0 when the work can be expressed as restricted host processes. If a
test genuinely needs a listening service or a package-installed dependency,
declare those needs and let the router move it to Tier 1 or Tier 2.

Workspace writes are real. Remove `scratch.txt` when finished. Type `exit` to
close the exploration replica and let ECC finalize its cleanup journal.
