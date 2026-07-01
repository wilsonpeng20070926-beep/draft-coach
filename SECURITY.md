# Security Policy

## Supported Versions

Security fixes are handled for the latest public release and the current `main` branch.

## Reporting A Vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub private vulnerability reporting if it is enabled on the public repository. If it is not enabled yet, contact the maintainers through the support channel listed in [SUPPORT.md](SUPPORT.md) and provide:

- affected version or commit
- operating system
- reproduction steps
- expected and observed behavior
- whether local League client credentials, config files, or network requests are involved

## Security Notes

Draft Coach reads the local League Client Update API token from the running League client process so it can access local champ-select state. The token is used in memory for local client communication and should not be logged, persisted, or sent to third-party services.
