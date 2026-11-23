# Deploy NumShift to Render

NumShift runs as a Python **Web Service**, not a static site, because AI title generation uses the server-side `/api/generate-titles` endpoint. The editor, imports and PDF creation run in the browser. The `render.yaml` blueprint defaults to a free web service; review Render's current plans and charges before deploying.

1. Put the project files in a **private Git repository**. Never commit `exports/`, `.env`, keys or private documents. The provided `.gitignore` excludes them.
2. In Render, create **New → Blueprint** and connect that repository. Render reads `render.yaml` from its root.
3. When prompted, add `OPENAI_API_KEY` in Render's secret environment settings. Do **not** paste the key into source files or chat. Optionally update `OPENAI_MODEL` to a supported model.
4. Deploy. The app listens on Render's supplied `PORT`; `/healthz` is the HTTP health check. Open the `onrender.com` address in a normal browser tab.
5. Test number editing, file import and browser PDF download. Configure an OpenAI project hard spend limit and alerts before enabling public AI traffic, then test AI title generation with a non-sensitive title.

## Operational and security notes

- The supplied blueprint disables **Save to workspace** on Render (`NUMSHIFT_WORKSPACE_EXPORTS=false`). PDFs and ZIPs are generated and downloaded in the browser; no generated file is written to the server. The preview-only workspace fallback is not appropriate for Render's ephemeral disk or shared users.
- The blueprint defaults `NUMSHIFT_ALLOW_NULL_ORIGIN=false`: API calls from opaque/sandboxed iframes are rejected. Use a normal tab. Local development defaults to allowing the embedded preview.
- The AI endpoint is anonymous and can consume your quota. Simple per-session, global per-minute and rolling 24-hour (`AI_DAILY_LIMIT`, default 100) limits run **per process**, reset on restart and can be bypassed or multiplied across instances. They are not a substitute for authentication, a verified CAPTCHA, distributed rate limiting and a hard OpenAI spend limit. For anything beyond controlled testing, add those controls before making the API public.
- Browser content is local except when a user requests AI title generation: the **title and count** are sent to the server and OpenAI. Do not use sensitive titles without an appropriate privacy policy and provider settings.
- Render free instances spin down on idle and use an ephemeral filesystem; plan and limits can change. No account-based or cross-device persistence is implemented.
- In embedded previews browser sandbox rules may block downloads. Normal browser tabs generally work, subject to browser settings. PDF exports are image-based; their text is not selectable.
- The current Python HTTP server and basic controls are suitable for a prototype, not a production security or scale guarantee. Add monitoring, managed rate limiting and load/security testing before wider deployment.

Sources: https://render.com/docs/blueprint-spec · https://render.com/docs/free · https://platform.openai.com/docs/guides/rate-limits
