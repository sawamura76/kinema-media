# When something goes wrong

Back to the [README](../README.md). Where the logs are, how to report a problem, and how to give feedback.

Skrin writes two logs to `%APPDATA%\com.kinema.app\logs\` on Windows and
`~/.local/share/com.kinema.app/logs/` on Linux. The quickest way there is
**Settings → Advanced → Developer tools → Open log folder**. On Android there
is no folder to open: the same place has **Share the log**, which sends the log
to an app of your choice, such as mail or a cloud drive.

- **`app.log`** — the app's own messages. The window's own console is
  invisible from outside the app, so this is where its errors go.
- **`mpv.log`** — the player's. This is the authority on anything about video:
  it records what actually happened in the render pipeline, not what was asked
  for.

Attach both to a [bug report](https://github.com/basswaves/skrin/issues/new?template=bug_report.yml).
On Windows and Linux, **Settings → Advanced → Developer tools → Send a report**
does it for you: both logs and the equipment check in one zip in your
Downloads folder, with your home folder's name replaced by `~`, and the form
opened in your browser. Skrin sends nothing itself; you attach the file.
They are the most useful thing you can send, and most problems here produce no
visible error at all — only a log line. Say which system, which device or
graphics card, and where the media is (a local disk, a USB drive or a NAS).

On Linux, Skrin is built to work the same everywhere rather than tested on
every desktop, version and driver — there are too many for one person. It
uses the shared standards first and falls back safely: where it cannot ask a
desktop to switch the screen, or a driver offers no HDR, the film still
plays. If your setup still misbehaves, a bug report with the logs, your
distribution, desktop and graphics card is how it gets fixed.

## Testing it and giving feedback

Skrin is tested on a small number of setups, and it is built to fall back
safely where it cannot test, so reports from other equipment are what shapes
what comes next. A question, or a story about how it went, is welcome in
[Discussions](https://github.com/basswaves/skrin/discussions). Three kinds of
report are welcome through
[Issues](https://github.com/basswaves/skrin/issues/new/choose):

- **A bug**, with the logs — [bug report](https://github.com/basswaves/skrin/issues/new?template=bug_report.yml).
- **"I tried it on this device"**, whether it worked or not — especially an
  Android TV box, a different TV or receiver, another Linux desktop,
  or a very large library —
  [device report](https://github.com/basswaves/skrin/issues/new?template=device_report.yml).
  A report that says "works" is as useful as one that says "broken".
- **An idea**, as a [feature request](https://github.com/basswaves/skrin/issues/new?template=feature_request.yml).
  Read the settled decisions in [CONTRIBUTING.md](../CONTRIBUTING.md) first: some
  things are deliberately not done, and the reasons are written down.

Code and documentation changes are welcome too; [CONTRIBUTING.md](../CONTRIBUTING.md)
says how to build, check and submit one. Anything exploitable goes to
[SECURITY.md](../SECURITY.md), not a public issue.
