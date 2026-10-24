# Image converter checks

Run `node tests/converter.cjs` for encoder, dimensions, naming, and ZIP checks. The generated `/tmp/converter-test.zip` can also be validated with Python's `zipfile` module.

Serve the repository with a local static HTTP server and open `/tests/converter-browser.html` in Chrome. This harness embeds a synthetic PNG and an opaque HEIC fixture generated with macOS sips, loads the converter in an iframe, and reports PASS/FAIL. It checks uploads, all six output formats, roundtrip dimensions, PNG transparency, corrupt-file isolation, ZIP generation, and clearing the queue. For file URLs, Chrome needs `--allow-file-access-from-files` in an isolated test profile.

A small HEIC fixture generated from a transparent PNG did not decode with the bundled HEIC library. Unsupported variants show a per-file error and do not stop the batch.
