# APF2.0 Workspace Scope

`APF2.0` was created as the dedicated development workspace for the new APF stack.

Included from the active new setup:

- Root app content from `APF_NEW`
- `CERTIFICATE_NEW`
- `DOCUMENTATION_NEW`
- `SFTP_NEW`

Left out because `APF_NEW` does not reference them directly:

- `APD`
- `APDOLD`
- `APF-1.0.4.ITF_MG_lots`
- `APF-1.0.7`
- `EDI_CERTIFICATE`
- `bibdata`
- `bibsh`

Intentionally not copied into `APF2.0`:

- `node_modules`
- build output
- runtime log files
- the unused nested `CERTIFICATE_NEW/APF_NEW` folder
