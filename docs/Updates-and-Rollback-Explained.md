# Updates and going back: how they work

*Written 22 Nov 2026. Covers MPH Register 0.6.0 (pull requests #22 and #29). The original screenshots show real
screens and are omitted from this text-only copy; the version numbers and data folder are illustrative.*

---

## 1. The short answer

**You publish a new version from your Mac with one tag. His app offers it, and one click installs it.**

- You push a tag such as `v0.6.1`. GitHub builds the Windows app on a Windows machine, runs every test and publishes it
  as a release.
- When his app opens, it sees the new version and shows a yellow bar: **New version 0.6.1 is ready**.
- He clicks **Update now**. The app downloads the new version, closes, and opens again by itself as 0.6.1.
- If the new version has a problem, **Menu → Go back to version 0.6.0** puts the old one back.

| | |
|---|---|
| What he needs | Internet, only while checking and downloading |
| What he types | Nothing; two clicks |
| His data | Stays on his laptop. Nothing is uploaded; only the app file is downloaded |
| Tokens or passwords on his laptop | None (the repository is public) |
| Time | About a minute: the download (about 110 MB) plus a few seconds to reopen |

---

## 2. One time only: putting 0.6.0 on his laptop

The exe on his laptop now is the older **0.5.0**. It has no update button, so this one step is done by hand. Every update
after it is the button.

1. Publish the first release from your Mac (see section 3):
   `git tag v0.6.0 origin/main && git push origin v0.6.0`
2. On his laptop, open the repository's **Releases** page
   (`https://github.com/CaptainVC/mph-register/releases`) and download `MPH-Register-win-x64.exe`.
3. Close MPH Register. Rename the download to **`MPH Register.exe`** and put it in `C:\MPH Register\`, replacing the old
   one. Leave the `MPH Register Data` folder next to it as it is.
4. Open it from the desktop shortcut. Because it came from a browser, Windows shows "Windows protected your PC" once
   more: **More info → Run anyway**. Updates the app downloads itself normally do not ask this again.
5. Open **Menu**. Under **App version** it should say **Version 0.6.0**.

---

## 3. Sending him an update (what you do)

1. Make the change on a branch, open a PR and merge it, as usual.
2. Raise the version in [Directory.Build.props](../app/Directory.Build.props), for example
   `<Version>0.6.1</Version>`, in a PR, and merge it. The new number must be **higher**; the app only offers higher numbers.
   Use the last number for fixes (0.6.1, 0.6.2) and the middle one for bigger changes (0.7.0).
3. Tag the merged commit and push the tag:

   ```sh
   git fetch origin
   git tag v0.6.1 origin/main
   git push origin v0.6.1
   ```

4. GitHub runs the **Release** workflow ([release.yml](../.github/workflows/release.yml)), which takes a few minutes:
   - It refuses if the tag does not match `<Version>` (for example the tag is `v0.6.1` but the file still says 0.6.0),
     or if the tagged commit is not on `main`.
   - It builds the app and runs all the tests on Windows. If a test fails, nothing is published and nothing reaches him.
   - It publishes the release **MPH Register 0.6.1** with the file `MPH-Register-win-x64.exe`.
   - The release notes are the titles of the commits since the last release (up to 25, without the PR numbers).
     He sees them under **What's new**, so plain-language PR titles matter.
5. That is all. His app sees it the next time he opens MPH Register. **Menu → Check for updates** asks straight away.

**A bad release can be taken back.** `gh release delete v0.6.1 --yes` (plus `git push origin :v0.6.1` to remove the tag)
stops it being offered. If he has already installed it, he can go back (section 5), or you publish a fixed 0.6.2.

---

## 4. What he sees when there is an update

### The update bar

When the app opens, it asks GitHub whether there is a newer version. It does not keep asking while it stays open. If
only the window is closed and opened again, the app reuses its last answer for up to 6 hours (5 minutes if the
internet was off). If there is a newer version, a yellow bar appears at the top:

- **Update now** installs it (next steps).
- **What's new** opens the release notes.

- **Later** hides the bar until he opens the app again. The update is also always in the menu (below).

In Hinglish the same bar reads:

### Installing

**Update now** first asks, so that half-typed entries are saved:

Then a small window shows the progress. He does not need to do anything:

The same window reloads by itself and confirms the update along its bottom edge.

### The menu

**Menu → App version** always shows the version and lets him check by hand:

| Situation | What the menu shows |
|---|---|
| A newer version is out | The new version is available to install. |
| No internet when checking | A message that the check could not complete; **Check for updates** can retry. |
| Just updated (newest, and the old one is still there) | The current version, with the previous version available to restore. |

On your Mac (or when running from a build folder) the menu shows the version, and **Check for updates** still says
whether a newer one is out. Installing and going back work only in the Windows app `MPH Register.exe`.

---

## 5. Going back to the previous version

After an update, the menu has **Go back to version 0.6.0**. It stays there until the next update.

What happens depends on one question: **did the new version change how the data is stored?** The app keeps its data
in a format with a number. When a new version adds something to the data (a new column, a new table), it raises that
number. An older version refuses a data file with a number it does not know. So going back must either keep the data
(same format) or put back the data from before the update (newer format).

### Usual case: the data format did not change

Going back keeps everything, including the entries made after the update:

### The data format changed: a red warning

The older version cannot read today's data, so going back puts the data back to **how it was at the update**. The
warning gives the date and time of the update:

- Entries, bills and setting changes made since then are **undone in the app, but not deleted**. Today's data and config
  are first copied to `MPH Register Data\rollback\kept-<date>-from-0.6.1\` (section 7 explains how to get them back).
- The app refuses to undo changes unless this warning was confirmed, even if something else asked it to.

### Then

The app opens the previous version. The version he left (0.6.1) does **not** show in the yellow bar again, so he is not
asked repeatedly. It is still in the menu if you want him to try it again. A newer 0.6.2 is offered normally.

---

## 6. What happens behind the scenes

### The update, step by step

Going back works the same way. The app copies itself to `MPH Register.rollback.exe`, starts the copy and closes. The
copy waits for it to close, swaps the two exes (putting back the data too if needed) and starts the older version.

`MPH Register.exe` is kept separately from `MPH Register Data`. The update keeps a previous app copy and uses
`MPH Register.rollback.exe` temporarily to perform the swap. Backups and rollback data remain under the data folder.

### What keeps it safe

| Risk | What stops it |
|---|---|
| A broken build reaches him | The release is built and **all tests run on Windows** before anything is published. A failing test publishes nothing. |
| A half-downloaded or damaged file | The download must have exactly the **size and SHA-256 fingerprint** that GitHub lists for the file; otherwise it is thrown away and the app stays as it was. |
| Someone else's file | It downloads only over HTTPS from the repository's latest release, and only the file named `MPH-Register-win-x64.exe`. |
| An update while he is typing | Nothing installs by itself; he is asked first and told to save. |
| The swap fails (antivirus holding the file, etc.) | Each step is retried for up to 30 seconds. If it still fails, the old app is put back and opens as before. |
| An update that damages data | The app backs up the data every time it starts (newest 30 kept in `backups\`), and the update keeps a separate copy in `rollback\` from just before the new version opened it. |
| Going back loses work | Today's data is always copied to `rollback\kept-…\` before anything is put back. |
| Another website on his laptop tries to trigger an update | The app only answers requests from his own computer, and installing needs a header that other websites cannot send. |

---

## 7. When something goes wrong

| He sees | What it means | What to do |
|---|---|---|
| Menu: "Could not check for a new version. Is the internet on?" | No internet, or GitHub did not answer | Nothing; it asks again next time. **Check for updates** retries now. |
| "Could not update: …" in red at the bottom | The download failed or was damaged | Nothing has changed. Try again later. |
| "The update did not finish, so this is still the old version." | The new file could not be put in place | Usually antivirus. Try again; if it repeats, look at the black window's message on a call. |
| "The app did not open again. Open MPH Register from the desktop." | The window waited 2 minutes and the app did not answer | Open it from the desktop shortcut. If `MPH Register.exe` is missing, rename `MPH Register.previous.exe` to `MPH Register.exe`. |
| He closed the window during an update | — | The new version opens a new window by itself after a few seconds. |
| "Could not go back: There is no earlier version to go back to." | There was no in-app update yet, or the old exe was deleted | Going back is not possible; publish a fixed version instead. |

### Getting back the data kept when going back undid changes

If he went back over a data format change, the work done between the update and going back is in
`C:\MPH Register\MPH Register Data\rollback\kept-<date>-from-<version>\` (`mph-data.db` and `mph-config.json`).

- **To see what was in it:** get the folder to your Mac (the hotspot transfer from before works) and open a copy of it
  with the newer version on a spare port:
  `MPH_DATA_DIR="<copy of that folder>" MPH_PORT=5199 dotnet "…/MPH Register.dll"`. Re-enter what is missing on his laptop.
- **To use it again once a fixed version is out:** after he updates to the fixed version, close the app, copy the two
  files from the kept folder into `MPH Register Data`, and open the app. Anything entered **after going back** is then
  replaced, so only do this if he entered nothing since. Otherwise re-enter by hand.

---

## 8. Limits

- **One step back.** He can go back only to the version he updated from, and only until the next update replaces the
  restore point.
- **Not back to 0.5.0.** The first 0.6.0 is put on his laptop by hand (section 2), so there is no in-app update to undo.
  Going back works from the first in-app update (0.6.0 → 0.6.1) onwards.
- **Windows app only.** Nothing is installed on the Mac or from a build folder.
- **The first download from a browser** shows the Windows "protected your PC" warning once.
- **Release notes are public**, like the repository: they are the commit titles, which are already public on GitHub.

---

## 9. Where it is in the code and how it is tested

| Part | File |
|---|---|
| Asking GitHub, downloading and checking the file | [UpdateService.cs](../app/src/MPHRegister.Services/Updates/UpdateService.cs) |
| Swapping the exe, file names, version numbers | [UpdateFiles.cs](../app/src/MPHRegister.Services/Updates/UpdateFiles.cs) |
| Restore point, putting data back, the kept copy | [RollbackFiles.cs](../app/src/MPHRegister.Services/Updates/RollbackFiles.cs), [RollbackService.cs](../app/src/MPHRegister.Services/Updates/RollbackService.cs) |
| Handing over between the processes on Windows | [SelfUpdate.cs](../app/src/MPHRegister.Api/Hosting/SelfUpdate.cs), [Program.cs](../app/src/MPHRegister.Api/Program.cs) |
| The API (`/api/updates`, `/install`, `/rollback`) | [UpdatesController.cs](../app/src/MPHRegister.Api/Controllers/UpdatesController.cs) |
| The bar, menu and dialogs | [app.js](../app/src/MPHRegister.Api/wwwroot/app.js) (search for "New versions"), Hinglish in [i18n.js](../app/src/MPHRegister.Api/wwwroot/i18n.js) |
| Publishing a release | [release.yml](../.github/workflows/release.yml) |

**Tests**

- **Unit tests**, 34 of them: [UpdateServiceTests.cs](../app/tests/MPHRegister.UnitTests/Updates/UpdateServiceTests.cs),
  [UpdateSwapTests.cs](../app/tests/MPHRegister.UnitTests/Updates/UpdateSwapTests.cs) and
  [RollbackTests.cs](../app/tests/MPHRegister.UnitTests/Updates/RollbackTests.cs). They cover version numbers,
  damaged downloads, a failed swap putting the old app back, keep vs restore, the kept copy, and the confirm guard.
- **Screen tests:** [ui-updates.js](../app/tests/e2e/ui-updates.js) and [ui-rollback.js](../app/tests/e2e/ui-rollback.js)
  check the update and rollback screens in English and Hinglish.
- **The real thing on Windows, on every pull request:** the CI job **Windows app updates itself** runs
  [test-self-update.sh](../scripts/test-self-update.sh). It installs a 0.0.1 app and updates it to 0.0.2 from a
  release served on the machine. Then it pretends 0.0.2 changed the data format and goes back to 0.0.1. It checks that
  the data from the update was put back, today's was kept, both exes are there and 0.0.2 is not offered again.
