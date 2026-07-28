# n8n workflow — archived, not required

`RepoRadar.json` is the original n8n Cloud workflow that handled routing and Discord
delivery. **It is no longer part of the running pipeline.**

That logic now lives in the API, so RepoRadar has no third-party automation runtime:

| n8n node | Ported to |
|----------|-----------|
| `Verify Token` (IF) | dropped — no cross-service hop, so no shared-secret header |
| `Route by Event` (Switch) | `buildDiscordPayload()` in `api/src/discord/embeds.ts` |
| `Build Push / PR / Issue Embed` (Code ×3) | `api/src/discord/embeds.ts` |
| `Send to Discord` (HTTP, retry 5×/3s) | `deliverToDiscord()` in `api/src/discord/deliver.ts` |
| `Handle Discord Failure` + `Respond 502` | `DiscordDeliveryError` → route replies `502` |

The file is kept for reference and for anyone who wants to run the flow in n8n instead.
Its credentials have been replaced with `REPLACE_WITH_*` placeholders — if you import it,
supply your own Discord webhook URL and forward token.
