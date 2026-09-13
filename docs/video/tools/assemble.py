#!/usr/bin/env python3
"""
Assemble the POLARIS-X demo video:
  title card → recorded take (warm-up trimmed) → end card,
  with the narration laid on at the recorded cue times, plus an .srt.

Run:  python3 /tmp/vidgen/assemble.py
"""
import json, os, re, subprocess, sys

FF = open('/tmp/vidgen/ff_path.txt').read().strip()
W = '/tmp/vidgen'
OUT = '/home/user/dakshin-marg/docs/video'
AUDIO = f'{OUT}/audio'
os.makedirs(f'{W}/build', exist_ok=True)
os.makedirs(OUT, exist_ok=True)

TITLE_DUR = 4.5
END_DUR = 7.0
FPS = 30


def run(args, label):
    p = subprocess.run(args, capture_output=True)
    if p.returncode != 0:
        print(f'FAIL {label}\n' + p.stderr.decode()[-2500:])
        sys.exit(1)
    print(f'ok   {label}')


tl = json.load(open(f'{W}/timeline.json'))
cues = {c['name']: c['t'] for c in tl['cues']}
take = cues['take_start']
total = tl['total']
take_dur = total - take + 3.0           # let the last frame settle
print(f'take starts at {take:.2f}s · take length {take_dur:.2f}s')

# narration placement: clip → (cue name, offset seconds inside the act)
PLAN = [
    ('s01_hook',            'shot01_cue',        0.4),
    ('s02_live',            'shot02_cue',        0.4),
    ('s03_seaice',          'shot03_cue',        0.4),
    ('s04_icebergs',        'shot04_cue',        0.6),
    ('s05_risk',            'shot05_cue',        0.4),
    ('s06_routes',          'shot06_cue',        0.4),
    ('s07_mission_create',  'shot07_cue',        0.6),
    ('s08_underway',        'shot08_cue',        0.4),
    ('s09_review_replan',   'shot09_cue',        0.4),
    ('s10_drill',           'shot10_cue',        0.4),
]

# ── narration audio: one delayed copy per clip, mixed ────────────────────────
inputs, filters, mixes = [], [], []
for i, (clip, cue, off) in enumerate(PLAN):
    path = f'{AUDIO}/{clip}.mp3'
    if not os.path.exists(path):
        print('missing', path); sys.exit(1)
    inputs += ['-i', path]
    delay = int(round((TITLE_DUR + (cues[cue] - take) + off) * 1000))
    filters.append(f'[{i}:a]adelay={delay}|{delay},volume=1.0[a{i}]')
    mixes.append(f'[a{i}]')
filters.append(''.join(mixes) + f'amix=inputs={len(PLAN)}:normalize=0:duration=longest[out]')
run([FF, '-y', '-hide_banner', '-loglevel', 'error', *inputs,
     '-filter_complex', ';'.join(filters), '-map', '[out]',
     '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
     f'{W}/build/narration.m4a'], 'narration mix')

# ── video segments ──────────────────────────────────────────────────────────
run([FF, '-y', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-t', str(TITLE_DUR), '-i', f'{W}/cards/title.png',
     '-vf', f'scale={1600}:{900},fps={FPS},fade=t=in:st=0:d=0.7,fade=t=out:st={TITLE_DUR-0.7}:d=0.7,format=yuv420p',
     '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', f'{W}/build/01_title.mp4'], 'title card')

import glob
cands = sorted(glob.glob(f'{W}/video/*.webm'), key=os.path.getmtime)
if not cands:
    print('no recorded webm in', f'{W}/video'); sys.exit(1)
TAKE_FILE = cands[-1]
print('take file:', TAKE_FILE)
run([FF, '-y', '-hide_banner', '-loglevel', 'error', '-ss', f'{max(0, take - 1.0):.2f}', '-i', TAKE_FILE,
     '-t', str(take_dur), '-vf', f'fps={FPS},scale=1600:900,format=yuv420p',
     '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-an', f'{W}/build/02_take.mp4'], 'take segment')

run([FF, '-y', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-t', str(END_DUR), '-i', f'{W}/cards/end.png',
     '-vf', f'scale={1600}:{900},fps={FPS},fade=t=in:st=0:d=0.7,fade=t=out:st={END_DUR-0.9}:d=0.9,format=yuv420p',
     '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', f'{W}/build/03_end.mp4'], 'end card')

with open(f'{W}/build/list.txt', 'w') as fh:
    for seg in ('01_title', '02_take', '03_end'):
        fh.write(f"file '{W}/build/{seg}.mp4'\n")
run([FF, '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', f'{W}/build/list.txt',
     '-c', 'copy', f'{W}/build/silent.mp4'], 'concat')

# ── mux ─────────────────────────────────────────────────────────────────────
probe = subprocess.run([FF, '-i', f'{W}/build/silent.mp4'], capture_output=True).stderr.decode()
dur = float(re.search(r'Duration: (\d+):(\d+):([\d.]+)', probe).group(1)) * 3600 \
    + float(re.search(r'Duration: (\d+):(\d+):([\d.]+)', probe).group(2)) * 60 \
    + float(re.search(r'Duration: (\d+):(\d+):([\d.]+)', probe).group(3))
print(f'video duration {dur:.1f}s')
run([FF, '-y', '-hide_banner', '-loglevel', 'error', '-i', f'{W}/build/silent.mp4', '-i', f'{W}/build/narration.m4a',
     '-filter_complex', f'[1:a]apad,atrim=0:{dur:.2f}[a]', '-map', '0:v', '-map', '[a]',
     '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
     f'{OUT}/POLARIS-X-demo.mp4'], 'final mux')
run([FF, '-y', '-hide_banner', '-loglevel', 'error', '-i', f'{W}/build/narration.m4a',
     '-t', f'{dur:.2f}', '-c:a', 'libmp3lame', '-b:a', '192k', f'{OUT}/POLARIS-X-narration.mp3'], 'narration mp3')

# ── subtitles ───────────────────────────────────────────────────────────────
TEXTS = {
    's01_hook': "Every austral summer, India's research stations are resupplied through Antarctic sea ice — where the ice charts are days old, icebergs move, and the ice edge can shift overnight. POLARIS-X turns open satellite and model data into a risk picture, route options, and a re-planning decision — and it keeps the human in command at every step.",
    's02_live': "This is the running system, in LIVE mode. Everything on screen is computed from real datasets — NSIDC sea-ice concentration, USNIC iceberg positions, BYU and NIC iceberg tracks, and Open-Meteo wind and temperature. Every layer declares what it is and how old it is: observation, model output, or planned. Ocean currents and waves are planned — no data source is connected yet, so the system says so, instead of drawing something that does not exist.",
    's03_seaice': "This is the latest NSIDC daily analysis in our data window — the first of September, mean concentration thirty-nine point eight percent along the corridor. I can step back through eight observation days, or forecast forward. At plus forty-eight hours the damped-trend model gives forty-two percent, with an uncertainty band of five point seven percent and a backtest error of four percent — against four point two for persistence. The badge changes to SEA-ICE FORECAST, because this is model output, not an observation.",
    's04_icebergs': "Thirteen icebergs are charted in this area; seventeen have real tracks from the BYU database, and five are classified as moving. The drift forecast carries an empirical P90 corridor of about forty-two kilometres at seven days. And the card states openly that the track archive lags real time — which is why current positions come from the USNIC chart.",
    's05_risk': "Risk is the core product: the IMO POLARIS risk index for sea ice, Overland's icing predictor, and iceberg hazard zones — combined worst-case, never averaged. With a PC5 ice class, the worst cell in the area is normal operation: RIO plus ten. Now watch the only thing I change — the vessel. PC7: minus nine, and a quarter of the cells move into the elevated band. No ice class at all: minus forty-nine, and over half the area becomes critical. Same ocean, same data — the vessel changes the answer.",
    's06_routes': "For routing, the optimizer does not invent cost weights — it applies severity ceilings as hard constraints. DIRECT is eight hundred and sixty-seven nautical miles, sixty-nine hours, with twenty percent of the route in medium severity. CONSERVATIVE costs a hundred and thirty extra miles to keep the whole route low. The recommendation cites IMO circular 1519 — avoid elevated-risk areas when planning. And fuel reads NOT COMPUTED, because no validated consumption model exists. We do not guess numbers we cannot defend.",
    's07_mission_create': "Now the real workflow — a resupply mission. Origin picked on the map, destination Bharati station in Prydz Bay, departure the second of September. The wizard validates the date against the actual data window — the twenty-fifth of August to the fourth of September — and tells me which observation and which weather hour it will use. Ice class PC5, twelve and a half knots, and a deliberately strict ceiling: nothing worse than low on the remaining route.",
    's08_underway': "Three options for that departure — all eight hundred and sixty-nine miles and low at this hour. I take the recommended DIRECT line. Acceptance is a human click: the system never starts a voyage by itself. The vessel then moves along the accepted geometry at the optimizer's own speed model — there is no decorative animation. I advance the mission clock twelve hours at a time; conditions at the vessel update with the clock, and every three simulated hours the remaining route is re-assessed against the data valid at that time.",
    's09_review_replan': "There it is — ROUTE REVIEW REQUIRED. The re-assessment found medium severity on the remaining route, which breaks the ceiling the operator set. It names the primary factor, and it pauses. It does not reroute on its own. I ask for alternatives from our current position, at the current time. Three candidates; CONSERVATIVE is recommended — five hundred and seventy miles, and the smallest exposure of the three. I accept it: the active route changes, the track restarts from this point, and the decision is written into the mission log.",
    's10_drill': "For the finale, a repeatable drill. It simulates exactly one fact — iceberg D23 ungrounding and drifting a hundred kilometres north, into our corridor — and every route, every risk number and every corridor radius is computed by the same live engines you have just seen. Twenty-four hours at cruise speed: three hundred miles covered, then the simulated re-sighting arrives, and D23 is inside the corridor. The remaining leg goes from low to critical, with a closest approach of two and a half kilometres. Re-planning recommends CONSERVATIVE: five hundred and ninety-two miles, all low — twenty-five miles longer than staying put. I accept it, and the new route becomes active.",
}

def ts(sec):
    h, rem = divmod(sec, 3600); m, s = divmod(rem, 60)
    return f'{int(h):02d}:{int(m):02d}:{s:06.3f}'.replace('.', ',')

def chunks(text, n):
    words = text.split()
    size = max(1, len(words) // n + (1 if len(words) % n else 0))
    return [' '.join(words[i:i + size]) for i in range(0, len(words), size)]

lines, idx = [], 1
for clip, cue, off in PLAN:
    start = TITLE_DUR + (cues[cue] - take) + off
    # use the audio's real length for subtitle pacing
    p = subprocess.run([FF, '-i', f'{AUDIO}/{clip}.mp3'], capture_output=True).stderr.decode()
    mm = re.search(r'Duration: (\d+):(\d+):([\d.]+)', p)
    alen = float(mm.group(1)) * 3600 + float(mm.group(2)) * 60 + float(mm.group(3))
    txt = TEXTS[clip]
    parts = chunks(txt, max(2, round(alen / 7)))
    total_chars = sum(len(x) for x in parts)
    t = start
    for part in parts:
        d = alen * (len(part) / total_chars)
        lines.append(f'{idx}\n{ts(t)} --> {ts(t + d - 0.05)}\n{part}\n')
        idx += 1
        t += d

open(f'{OUT}/POLARIS-X-demo.srt', 'w').write('\n'.join(lines))

print('\ncues (take-relative):')
for k in sorted([c for c in cues if c.startswith('shot') or c in ('take_start', 'end')]):
    print(f'  {k:24s} {cues[k] - take:7.2f}s')
print('final:', f'{OUT}/POLARIS-X-demo.mp4')
