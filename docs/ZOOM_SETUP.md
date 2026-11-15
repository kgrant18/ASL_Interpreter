# SignBridge in Zoom: voice + closed captions

You only look at Zoom. SignBridge reads the camera itself (Zoom keeps your video), speaks each
recognized sentence through **BlackHole 2ch** (your Zoom microphone), and can post it as a
Zoom **closed caption** for everyone.

## One-time setup (Mac)
1. `brew install blackhole-2ch` (restart once after installing).
2. Run SignBridge from **Terminal**: `./scripts/dev.sh`.
3. The first time you press **Start**, macOS asks *"Terminal would like to access the camera"*: click **Allow**.
   If you missed it: System Settings → Privacy & Security → Camera → turn on **Terminal**, then quit Terminal and
   run `./scripts/dev.sh` again. (If you start SignBridge from another app, e.g. iTerm or the Claude app, that app
   needs the permission instead.)

## Host: enable the caption API (once per Zoom account)
Captions need the **meeting host** to allow third-party captioning. If you are not the host, send them this section.

1. Sign in at **https://zoom.us** → **Settings** (left side) → **Meeting** tab → **In Meeting (Advanced)**.
   (Quick way: use the search box at the top of Settings and type *caption*.)
2. Turn on **Closed captioning**.
3. Tick **Allow use of caption API Token to integrate with 3rd-party Closed Captioning services** → **Save**.
4. If the toggle is greyed out, it is locked by your account admin (school/company accounts): ask them, or host from
   a personal Zoom account.

## Each meeting: copy the token into SignBridge
The token is tied to one meeting. **If the meeting ends and restarts, copy a new token.**

1. Start the meeting as host.
2. In the meeting toolbar click **Captions** (CC icon; on a narrow window it is under **More …**).
   - Newer Zoom: **Captions** → **Set up manual captioner** (or **Caption settings → Manual captioner**) →
     under *Use a 3rd-party CC service* click **Copy the API token**.
   - Older Zoom: **Closed Caption** button → **Copy the API token**.
3. In SignBridge (http://localhost:5173) paste it into **Zoom captions** → **Save token** → **Test caption**.
   Green *"Test caption delivered"* = working. A red message explains what to fix (expired token, captions
   disabled, no internet …).

## Participants: turn captions on
Each participant clicks **Captions** (CC) in the toolbar → **Show captions**
(phone app: **More** → **Captions** / **Closed Caption** → on). The caption appears as
`I have an idea.`

## Start
1. Zoom → Settings → Audio: **Microphone = BlackHole 2ch**, untick *Automatically adjust microphone volume*,
   *Suppress background noise = Low*. Turn your Zoom video on as normal.
2. SignBridge → **Start**. Check the four status tiles (Camera, Recognition, Voice, Captions) are green and the
   framing view shows the green line across both shoulders.
3. Minimize the SignBridge window and bring Zoom to the front. The **menu-bar icon** keeps showing status:
   `● SignBridge` live · `⏸` sending stopped · `⚠` problem (open the menu to see which) · `○` not started.
4. To stop sending at any time: menu-bar icon → **Stop sending to the call**, or Ctrl+Shift+M in the SignBridge
   window. Zoom's own mute (Cmd+Shift+A) also silences the voice (captions still go out).

## 2-minute test with a second participant
Second participant = a teammate, or your phone joined to the meeting with sound on.

| Time | Do | Expect |
|---|---|---|
| 0:00 | Start the meeting, paste token, **Test caption** | Phone shows `SignBridge captions are connected.` (after turning on captions) |
| 0:20 | SignBridge **Start**, then **Send test sentence** | Phone hears "SignBridge is connected." and sees it as a caption |
| 0:40 | Minimize SignBridge, Zoom in front, your video on | Phone still sees your video; menu bar shows `● SignBridge` |
| 0:50 | Sign the 5 sentences, hands down for ~2 s after each | Each sentence is heard **once** and captioned **once** on the phone |
| 1:40 | Scratch your face / talk with your hands for 10 s | Nothing is spoken or captioned |
| 1:50 | Menu bar → **Stop sending**, sign *Thank you* | Nothing reaches the phone; menu shows `⏸`. Then **Resume sending** |

## Troubleshooting
| Symptom | Fix |
|---|---|
| Camera tile: *Could not open the camera* | Camera permission for Terminal (see above), then press Start again. |
| Camera stuck on *Starting…* right after granting permission | Quit Terminal, run `./scripts/dev.sh` again. |
| Wrong camera (e.g. iPhone Continuity Camera) | Stop, then `SIGNBRIDGE_CAMERA=1 ./scripts/dev.sh`. |
| Captions tile red: *rejected the caption token (HTTP 403)* | Meeting restarted or the setting is off → copy a new API token. |
| Captions tile red: *HTTP 400* | Meeting not running, or you are in a breakout room. |
| Captions OK but participants see nothing | They must click **Captions → Show captions**. |
| Voice tile red: *BlackHole not found* | `brew install blackhole-2ch`, restart the Mac. |
| Participants hear nothing | Zoom mic must be **BlackHole 2ch** and not muted in Zoom. |
| Background capture won't work at all | Use **Use the in-browser camera instead** (bottom of the page) and keep that window visible next to Zoom. |
