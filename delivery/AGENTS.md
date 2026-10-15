# Codex automatic installation handoff

This folder is the user's requested installation kit for CinePrompt and the Photoshop Local Edit plugin. If the user asks to install/use this kit, complete installation and verification rather than only describing steps.

1. Read `README-先读我.md` and inspect `install.ps1`.
2. Run `install.ps1 -CheckOnly` from this folder to verify the manifest hashes and prerequisites before executing the bundled installer. Do not skip failed integrity checks.
3. Run `install.ps1`. It installs the verified desktop runtime, applies the chat picker fix, deploys the PS plugin and helper, creates a desktop shortcut, starts the app and checks its local HTTP health. Use hidden windows for shell helpers. Installation can take 15–25 minutes on some computers; wait for the installer process to exit and do not launch multiple copies.
4. Inspect `installation-report.json`. Report actual outcomes. Photoshop may require restart to discover the plugin. Never claim PS generation has succeeded based only on a copied manifest.
5. API credentials are intentionally absent. Let the owner enter their own key in the application's API settings and in the PS panel. Never request a screenshot containing a key, print credentials, copy the sender's credentials, or make a paid AI generation call without user authorization.
6. If Photoshop is missing or unsupported, finish desktop installation and clearly state the missing prerequisite. Do not install Photoshop, change security controls or bypass OS warnings. Stop for user handling of any OS consent that requires it.
7. Do not publish recipient settings, logs, uploads or history. Do not replace existing .env.local or user data. The ZIP contains both source trees and runnable patches, so no Node.js installation or frontend rebuild is needed for ordinary installation.

Scope: Windows x64, Photoshop 25+ for the plugin. macOS/Linux are not supported by this installer. API availability depends on the recipient's provider/account.
