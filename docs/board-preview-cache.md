# Investigation board preview loading

The board keeps loaded preview URLs and card elements while navigating to the journal, suspending polling, or restoring a background tab. Hiding the board aborts pending reads but retains completed previews. An unchanged board snapshot does not rebuild its cards.

Rendered thumbnails also use a local Cache Storage store so reloading the page can reuse image and PDF previews without downloading the originals or rendering PDF pages again. Keys include the immutable source file ID and preview profile. A SHA-256 namespace scopes each cache entry to the current player credentials; raw tokens and document titles are not written into cache URLs. The board API must still load the authorized room snapshot before previews are restored.

The local store is limited to 60 entries / 20 MiB, individual previews to 2 MiB, and expiry to six hours or token expiration, whichever comes first. Logout, session expiration and room completion clear the session's previews. Storage denial, errors or reads exceeding 500 ms fall back to regular loading. In-memory previews remain limited to 40 entries.

Image requests use `preview=board`: the server produces a 960px-wide WebP at quality 85, preserving alpha. The normal document viewer retains its existing larger quality-90 image path. Source uploads are never rewritten. PDF board previews render only the first page into a WebP and cache that rendered result locally.
