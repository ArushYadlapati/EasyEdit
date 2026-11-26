import { describe, expect, it } from "vitest";
import { readEdl, writeEdl } from "@/lib/interchange/edl";
import { readFcp7, writeFcp7 } from "@/lib/interchange/fcp7";
import { baseName, formatOf, framesOf, timecode, type SeqClip, type Sequence } from "@/lib/interchange/model";
import { readOtio, writeOtio } from "@/lib/interchange/otio";
import { child, children, escapeXml, parseXml, textOf, unescapeXml } from "@/lib/interchange/xml";

const clip = (over: Partial<SeqClip>): SeqClip => ({ name: "a.mp4", fileName: "a.mp4", kind: "video", track: 0, start: 0, duration: 2, in: 0, speed: 1, ...over });
const seq = (clips: SeqClip[], over: Partial<Sequence> = {}): Sequence => ({ name: "Cut 1", fps: 30, width: 1920, height: 1080, clips, markers: [], notes: [], ...over });
const read = <T extends { ok: boolean }>(result: T) => {
  if (!result.ok) throw new Error((result as unknown as { message: string }).message);
  return (result as unknown as { sequence: Sequence }).sequence;
};
// What a reader must give back of a clip, whatever else it adds.
const core = (c: SeqClip) => ({ fileName: c.fileName, kind: c.kind, track: c.track, start: +c.start.toFixed(3), duration: +c.duration.toFixed(3), in: +c.in.toFixed(3), speed: c.speed });

describe("the small XML reader", () => {
  it("reads elements, attributes, text, entities and CDATA, and skips what is not content", () => {
    const root = parseXml('\uFEFF<?xml version="1.0"?>\n<!DOCTYPE xmeml>\n<a x="1" y=\'two &amp; 2\'><!-- note --><b>Tom &amp; Jerry &#233;</b><c/><d><![CDATA[<raw>]]></d><b>again</b></a>')!;
    expect(root.name).toBe("a");
    expect(root.attrs).toEqual({ x: "1", y: "two & 2" });
    expect(textOf(root, "b")).toBe("Tom & Jerry é");
    expect(children(root, "b").map((b) => b.text)).toEqual(["Tom & Jerry é", "again"]);
    expect(child(root, "c")).toEqual({ name: "c", attrs: {}, children: [], text: "" });
    expect(textOf(root, "d")).toBe("<raw>");
    expect(textOf(root, "nope")).toBe("");
  });
  it("gives null for text that is not one whole document", () => {
    for (const bad of ["", "just words", "<a><b></a>", "<a>", "<a></a><b></b>", "<a x='1></a>", "<!-- never closed"]) expect(parseXml(bad), bad).toBeNull();
  });
  it("escapes what it writes so it reads back", () => {
    const name = 'A & B <"cut">';
    expect(unescapeXml(escapeXml(name))).toBe(name);
    expect(textOf(parseXml(`<a><n>${escapeXml(name)}</n></a>`)!, "n")).toBe(name);
  });
});

describe("names and times", () => {
  it("timecodes count every frame, both ways", () => {
    expect(timecode(0, 30)).toBe("00:00:00:00");
    expect(timecode(30 * 3661 + 7, 30)).toBe("01:01:01:07");
    expect(framesOf("01:01:01:07", 30)).toBe(30 * 3661 + 7);
    expect(framesOf("00:00:10;15", 30)).toBe(315);
    expect(framesOf("10:15", 30)).toBeNull();
  });
  it("a file's name is the last part of its path or URL", () => {
    expect(baseName("file://localhost/Volumes/Media/My%20Shoot/A001%20C003.mov")).toBe("A001 C003.mov");
    expect(baseName("C:\\footage\\take 2.mp4")).toBe("take 2.mp4");
    expect(baseName("plain.wav")).toBe("plain.wav");
  });
  it("tells the three formats apart by name and by how the file starts", () => {
    expect(formatOf("cut.xml", '<?xml version="1.0"?><!DOCTYPE xmeml><xmeml version="4">')).toBe("fcp7");
    expect(formatOf("cut.xml", "<fcpxml version='1.9'>")).toBeNull(); // the newer Final Cut format is another thing
    expect(formatOf("cut.otio", "{}")).toBe("otio");
    expect(formatOf("cut.json", '{ "OTIO_SCHEMA": "Timeline.1" }')).toBe("otio");
    expect(formatOf("cut.edl", "TITLE: x")).toBe("edl");
    expect(formatOf("cut.txt", "TITLE: Rough\nFCM: NON-DROP FRAME\n001  AX V C 00:00:00:00 00:00:01:00 01:00:00:00 01:00:01:00")).toBe("edl");
    expect(formatOf("holiday.mp4", "\u0000\u0000\u0000 ftyp")).toBeNull();
  });
});

// A two-track timeline as Premiere Pro writes it: a dissolve between two clips, a title-less overlay, stereo sound.
const PREMIERE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
 <sequence id="sequence-1">
  <name>Rough cut</name>
  <duration>240</duration>
  <rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate>
  <media>
   <video>
    <format><samplecharacteristics><width>1920</width><height>1080</height></samplecharacteristics></format>
    <track>
     <clipitem id="clipitem-1">
      <name>Interview A</name><enabled>TRUE</enabled><duration>900</duration>
      <start>0</start><end>-1</end><in>30</in><out>135</out>
      <file id="file-1"><name>A001.mov</name><pathurl>file://localhost/Volumes/Shoot/A001.mov</pathurl></file>
     </clipitem>
     <transitionitem><start>90</start><end>120</end><alignment>center</alignment><effect><name>Cross Dissolve</name></effect></transitionitem>
     <clipitem id="clipitem-2">
      <name>B-roll</name><enabled>TRUE</enabled><duration>600</duration>
      <start>-1</start><end>240</end><in>60</in><out>210</out>
      <file id="file-2"><name>B%20roll.mp4</name><pathurl>file://localhost/Volumes/Shoot/B%20roll.mp4</pathurl></file>
      <filter><effect><name>Time Remap</name><parameter><parameterid>speed</parameterid><value>200</value></parameter><parameter><parameterid>reverse</parameterid><value>FALSE</value></parameter></effect></filter>
     </clipitem>
    </track>
    <track>
     <clipitem id="clipitem-3">
      <name>Logo</name><enabled>TRUE</enabled><start>15</start><end>75</end><in>0</in><out>60</out>
      <file id="file-3"><name>logo.png</name><pathurl>file://localhost/Volumes/Shoot/logo.png</pathurl></file>
      <filter><effect><name>Opacity</name><parameter><parameterid>opacity</parameterid><value>50</value></parameter></effect></filter>
      <filter><effect><name>Basic Motion</name><parameter><parameterid>scale</parameterid><value>40</value></parameter></effect></filter>
     </clipitem>
     <clipitem id="clipitem-9"><name>Off</name><enabled>FALSE</enabled><start>100</start><end>130</end><in>0</in><out>30</out><file id="file-3"/></clipitem>
    </track>
   </video>
   <audio>
    <track>
     <clipitem id="clipitem-4"><name>Interview A</name><start>0</start><end>105</end><in>30</in><out>135</out><file id="file-1"/><sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
      <filter><effect><name>Audio Levels</name><parameter><parameterid>level</parameterid><value>0.5</value></parameter></effect></filter></clipitem>
    </track>
    <track>
     <clipitem id="clipitem-5"><name>Interview A</name><start>0</start><end>105</end><in>30</in><out>135</out><file id="file-1"/><sourcetrack><mediatype>audio</mediatype><trackindex>2</trackindex></sourcetrack></clipitem>
    </track>
    <track>
     <clipitem id="clipitem-6"><name>Music</name><start>0</start><end>240</end><in>0</in><out>240</out><file id="file-4"><name>song.wav</name><pathurl>file://localhost/Volumes/Shoot/song.wav</pathurl></file></clipitem>
    </track>
   </audio>
  </media>
  <marker><name>Hook</name><in>45</in><out>-1</out></marker>
 </sequence>
</xmeml>`;

describe("Final Cut Pro 7 XML", () => {
  it("reads a Premiere timeline: tracks, times in seconds, file names, speed, opacity, level, dissolve and marker", () => {
    const s = read(readFcp7(PREMIERE));
    expect([s.name, s.fps, s.width, s.height]).toEqual(["Rough cut", 30, 1920, 1080]);
    const [a, b, logo, ...sound] = s.clips;
    // The dissolve is centred on frame 105: A ends there, B starts there and its `in` moves on with it.
    expect(core(a)).toEqual({ fileName: "A001.mov", kind: "video", track: 0, start: 0, duration: 3.5, in: 1, speed: 1 });
    expect(core(b)).toEqual({ fileName: "B roll.mp4", kind: "video", track: 0, start: 3.5, duration: 4.5, in: 2.5, speed: 2 });
    expect(b.dissolveIn).toBe(1);
    expect(a.dissolveIn).toBeUndefined();
    expect(core(logo)).toMatchObject({ fileName: "logo.png", track: 1, start: 0.5, duration: 2 });
    expect(logo.opacity).toBe(0.5);
    // The switched-off clip is left out; the file named only by its id is still known.
    expect(s.clips.map((c) => c.name)).not.toContain("Off");
    expect(sound.map((c) => [c.kind, c.track, c.fileName, c.volume])).toEqual([["audio", 0, "A001.mov", 0.5], ["audio", 1, "A001.mov", undefined], ["audio", 2, "song.wav", undefined]]);
    expect(s.markers).toEqual([{ at: 1.5, name: "Hook" }]);
    expect(s.notes.join(" ")).toMatch(/1 clip has a position, size or crop of their own/);
    expect(s.notes.join(" ")).toMatch(/29\.97 frames a second; it was read as 30/);
  });
  it("finds the timeline inside a project's bins, and says when there is none", () => {
    const inBin = `<xmeml version="5"><project><name>P</name><children><bin><children><sequence><name>In a bin</name><rate><timebase>25</timebase></rate><media><video><track><clipitem><start>0</start><end>50</end><in>0</in><file id="f"><name>x.mp4</name></file></clipitem></track></video></media></sequence></children></bin></children></project></xmeml>`;
    expect(read(readFcp7(inBin))).toMatchObject({ name: "In a bin", fps: 25, clips: [{ fileName: "x.mp4", duration: 2 }] });
    expect(readFcp7("<xmeml version='4'><project><name>empty</name></project></xmeml>")).toMatchObject({ ok: false, message: expect.stringContaining("no timeline") });
    expect(readFcp7("<html></html>")).toMatchObject({ ok: false });
    expect(readFcp7("not xml")).toMatchObject({ ok: false, message: "That file is not XML this can read." });
    expect(readFcp7("<xmeml><sequence><rate><timebase>30</timebase></rate><media><video><track></track></video></media></sequence></xmeml>")).toMatchObject({ ok: false, message: "That timeline has no clips in it." });
  });
  it("leaves out a nested timeline and a speed ramp's shape, and says so", () => {
    const xml = `<xmeml version="4"><sequence><rate><timebase>30</timebase></rate><media><video><track>
      <clipitem><start>0</start><end>30</end><in>0</in><sequence><name>inner</name><media/></sequence></clipitem>
      <clipitem><start>30</start><end>60</end><in>0</in><file id="f"><name>x.mp4</name></file><filter><effect><name>Time Remap</name><parameter><parameterid>variablespeed</parameterid><value>1</value></parameter><parameter><parameterid>speed</parameterid><value>-50</value></parameter></effect></filter></clipitem>
    </track></video></media></sequence></xmeml>`;
    const s = read(readFcp7(xml));
    expect(s.clips.map((c) => c.speed)).toEqual([-0.5]);
    expect(s.notes).toEqual(["1 nested timeline was left out: flatten them before exporting.", "1 clip changes speed as it plays; it was given one speed."]);
  });
  it("writes a timeline that reads back the same", () => {
    const original = seq(
      [
        clip({ start: 0, duration: 3, in: 1, sound: true, volume: 0.5 }),
        clip({ name: "B & <b>", fileName: "b roll.mp4", start: 3, duration: 2, in: 4, speed: 2, dissolveIn: 0.5 }),
        clip({ fileName: "logo.png", name: "logo", track: 1, start: 1, duration: 1.5, opacity: 0.4 }),
        clip({ fileName: "back.mp4", name: "back", start: 6, duration: 1, in: 2, speed: -1 }),
        clip({ fileName: "song.wav", name: "song", kind: "audio", start: 0, duration: 7, in: 0.5, volume: 1.5 }),
      ],
      { markers: [{ at: 2, name: "Beat & drop" }] },
    );
    const xml = writeFcp7(original, 30, { width: 1920, height: 1080 }, (name) => (name === "a.mp4" ? 20 : null));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">')).toBe(true);
    expect(xml).toContain("<pathurl>file://localhost/b%20roll.mp4</pathurl>");
    expect(xml).toContain("<duration>600</duration>"); // a.mp4's own length, 20 s
    const back = read(readFcp7(xml));
    // The file lists a track at a time.
    const inFileOrder = (clips: SeqClip[]) => clips.filter((c) => c.kind === "video").sort((x, y) => x.track - y.track || x.start - y.start);
    const pictures = back.clips.filter((c) => c.kind === "video");
    expect(pictures.map(core)).toEqual(inFileOrder(original.clips).map(core));
    expect(pictures[1].dissolveIn).toBe(0.5);
    expect(pictures[1].name).toBe("B & <b>");
    expect(pictures.map((c) => c.speed)).toEqual([1, 2, -1, 1]);
    expect(pictures[3].opacity).toBe(0.4);
    // The sounding video clip's sound and the song are each a stereo pair: two tracks a lane.
    expect(back.clips.filter((c) => c.kind === "audio").map((c) => [c.fileName, c.track, c.volume])).toEqual([["a.mp4", 0, 0.5], ["a.mp4", 1, 0.5], ["song.wav", 2, 1.5], ["song.wav", 3, 1.5]]);
    expect(back.markers).toEqual([{ at: 2, name: "Beat & drop" }]);
    expect([back.fps, back.width, back.height]).toEqual([30, 1920, 1080]);
  });
});

const EDL = `TITLE: Rough cut
FCM: NON-DROP FRAME

001  AX       AA/V  C        00:00:01:00 00:00:04:00 01:00:00:00 01:00:03:00
* FROM CLIP NAME: A001.mov
002  AX       V     C        00:00:04:00 00:00:04:00 01:00:03:00 01:00:03:00
002  AX       V     D    024 00:00:10:00 00:00:12:00 01:00:03:00 01:00:05:00
* FROM CLIP NAME: A001.mov
* TO CLIP NAME: B roll.mp4
003  BL       V     C        00:00:00:00 00:00:01:00 01:00:05:00 01:00:06:00
004  TAPE7    A2    C        00:00:00:00 00:00:06:00 01:00:00:00 01:00:06:00
* FROM CLIP NAME: song.wav
M2   TAPE7    048.0 00:00:00:00
005  AX       NONE  C        00:00:00:00 00:00:01:00 01:00:06:00 01:00:07:00
`;

describe("an EDL", () => {
  it("reads events at the project's frame rate, names clips from the comment lines, and starts the timeline at zero", () => {
    const s = read(readEdl(EDL, 24));
    expect(s.name).toBe("Rough cut");
    expect(s.clips.map(core)).toEqual([
      { fileName: "A001.mov", kind: "video", track: 0, start: 0, duration: 3, in: 1, speed: 1 },
      { fileName: "B roll.mp4", kind: "video", track: 0, start: 3, duration: 2, in: 10, speed: 1 },
      { fileName: "song.wav", kind: "audio", track: 1, start: 0, duration: 6, in: 0, speed: 1 },
    ]);
    expect(s.clips.map((c) => c.sound)).toEqual([true, false, undefined]);
    expect(s.clips[1].dissolveIn).toBe(1);
    expect(s.notes).toEqual(["1 speed change was left out: an EDL's speed lines are not read.", "An EDL has no frame rate of its own: it was read at this project's, 24 frames a second."]);
  });
  it("says when there is nothing in it", () => {
    expect(readEdl("TITLE: empty\nFCM: NON-DROP FRAME\n", 30)).toEqual({ ok: false, message: "That EDL has no events in it." });
  });
  it("writes the lowest video track and four audio tracks, and reads back the same", () => {
    const original = seq([
      clip({ start: 0, duration: 3, in: 1, sound: true }),
      clip({ fileName: "b roll.mp4", name: "b", start: 3, duration: 2, in: 10, dissolveIn: 1, sound: false }),
      clip({ fileName: "logo.png", name: "logo", track: 1, start: 1, duration: 1 }),
      clip({ fileName: "song.wav", name: "song", kind: "audio", track: 1, start: 0, duration: 6, in: 0 }),
    ]);
    const { text, notes } = writeEdl(original, 24);
    expect(text).toContain("TITLE: Cut 1\nFCM: NON-DROP FRAME");
    expect(text).toContain("001  AX       AA/V  C        00:00:01:00 00:00:04:00 01:00:00:00 01:00:03:00\n* FROM CLIP NAME: a.mp4");
    expect(text).toContain("D    024 00:00:10:00 00:00:12:00 01:00:03:00 01:00:05:00");
    expect(notes).toEqual(["1 clip is on tracks an EDL has no room for (it holds one video track and four audio tracks)."]);
    const back = read(readEdl(text, 24));
    expect(back.clips.map(core).sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind))).toEqual(
      original.clips.filter((c) => c.fileName !== "logo.png").map(core).sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind)),
    );
    expect(back.clips.find((c) => c.fileName === "b roll.mp4")!.dissolveIn).toBe(1);
    expect(back.clips.find((c) => c.fileName === "a.mp4")!.sound).toBe(true);
  });
});

// A timeline as DaVinci Resolve writes it: a gap, a transition, a clip whose file's clock starts at one hour.
const RESOLVE = JSON.stringify({
  OTIO_SCHEMA: "Timeline.1",
  name: "Resolve cut",
  tracks: {
    OTIO_SCHEMA: "Stack.1",
    markers: [{ OTIO_SCHEMA: "Marker.2", name: "Chapter", marked_range: { start_time: { value: 48, rate: 24 }, duration: { value: 0, rate: 24 } } }],
    children: [
      {
        OTIO_SCHEMA: "Track.1",
        kind: "Video",
        children: [
          { OTIO_SCHEMA: "Clip.2", name: "A001", source_range: { start_time: { value: 86424, rate: 24 }, duration: { value: 72, rate: 24 } }, active_media_reference_key: "DEFAULT_MEDIA", media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", target_url: "/Volumes/Shoot/A001.mov", available_range: { start_time: { value: 86400, rate: 24 }, duration: { value: 2400, rate: 24 } } } } },
          { OTIO_SCHEMA: "Transition.1", in_offset: { value: 6, rate: 24 }, out_offset: { value: 6, rate: 24 } },
          { OTIO_SCHEMA: "Clip.1", name: "B", source_range: { start_time: { value: 0, rate: 24 }, duration: { value: 48, rate: 24 } }, media_reference: { OTIO_SCHEMA: "ExternalReference.1", target_url: "file:///Volumes/Shoot/B%20roll.mp4" }, effects: [{ OTIO_SCHEMA: "LinearTimeWarp.1", time_scalar: 0.5 }] },
          { OTIO_SCHEMA: "Gap.1", source_range: { start_time: { value: 0, rate: 24 }, duration: { value: 24, rate: 24 } } },
          { OTIO_SCHEMA: "Clip.1", name: "C", enabled: false, source_range: { start_time: { value: 0, rate: 24 }, duration: { value: 24, rate: 24 } }, media_reference: { OTIO_SCHEMA: "MissingReference.1" } },
          { OTIO_SCHEMA: "Stack.1", name: "compound", source_range: { start_time: { value: 0, rate: 24 }, duration: { value: 24, rate: 24 } } },
          { OTIO_SCHEMA: "Clip.1", name: "D.mp4", source_range: { start_time: { value: 12, rate: 24 }, duration: { value: 24, rate: 24 } }, media_reference: { OTIO_SCHEMA: "MissingReference.1" } },
        ],
      },
      { OTIO_SCHEMA: "Track.1", kind: "Audio", children: [{ OTIO_SCHEMA: "Clip.1", name: "song", source_range: { start_time: { value: 0, rate: 48000 }, duration: { value: 96000, rate: 48000 } }, media_reference: { OTIO_SCHEMA: "ExternalReference.1", target_url: "song.wav" } }] },
    ],
  },
});

describe("OpenTimelineIO", () => {
  it("reads a Resolve timeline: clips one after another, gaps, a transition, a file whose clock starts late, speed", () => {
    const s = read(readOtio(RESOLVE));
    expect([s.name, s.fps]).toEqual(["Resolve cut", 24]);
    expect(s.clips.map(core)).toEqual([
      { fileName: "A001.mov", kind: "video", track: 0, start: 0, duration: 3, in: 1, speed: 1 },
      { fileName: "B roll.mp4", kind: "video", track: 0, start: 3, duration: 2, in: 0, speed: 0.5 },
      // After the gap (1 s), the switched-off clip (1 s, left out) and the nested stack (1 s, left out).
      { fileName: "D.mp4", kind: "video", track: 0, start: 8, duration: 1, in: 0.5, speed: 1 },
      { fileName: "song.wav", kind: "audio", track: 0, start: 0, duration: 2, in: 0, speed: 1 },
    ]);
    expect(s.clips[1].dissolveIn).toBe(0.5);
    expect(s.markers).toEqual([{ at: 2, name: "Chapter" }]);
    expect(s.notes).toEqual(["1 nested timeline was left out: flatten them before exporting."]);
  });
  it("says what is wrong with a file that is not one", () => {
    expect(readOtio("{")).toMatchObject({ ok: false, message: expect.stringContaining("not JSON") });
    expect(readOtio('{"OTIO_SCHEMA":"Clip.1"}')).toEqual({ ok: false, message: "That file is not an OpenTimelineIO timeline." });
    expect(readOtio('{"OTIO_SCHEMA":"Timeline.1","tracks":{"children":[]}}')).toEqual({ ok: false, message: "That timeline has no clips in it." });
  });
  it("writes a timeline that reads back the same, with gaps where nothing plays", () => {
    const original = seq(
      [
        clip({ start: 1, duration: 3, in: 1, sound: true }),
        clip({ fileName: "b roll.mp4", name: "b", start: 4, duration: 2, in: 4, speed: 2, dissolveIn: 0.5 }),
        clip({ fileName: "logo.png", name: "logo", track: 1, start: 2, duration: 1.5 }),
        clip({ fileName: "song.wav", name: "song", kind: "audio", start: 0.5, duration: 7, in: 0.5 }),
      ],
      { markers: [{ at: 2, name: "Beat" }] },
    );
    const text = writeOtio(original, 30);
    const json = JSON.parse(text);
    expect(json.OTIO_SCHEMA).toBe("Timeline.1");
    expect(json.tracks.children.map((t: { kind: string }) => t.kind)).toEqual(["Video", "Video", "Audio", "Audio"]);
    expect(json.tracks.children[0].children.map((c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA)).toEqual(["Gap.1", "Clip.1", "Transition.1", "Clip.1"]);
    const back = read(readOtio(text));
    expect(back.clips.filter((c) => c.kind === "video").map(core)).toEqual(original.clips.filter((c) => c.kind === "video").map(core));
    // The sounding clip's sound gets an audio track of its own, before the song's.
    expect(back.clips.filter((c) => c.kind === "audio").map((c) => [c.fileName, c.track, c.start])).toEqual([["a.mp4", 0, 1], ["song.wav", 1, 0.5]]);
    expect(back.clips[1].dissolveIn).toBe(0.5);
    expect(back.markers).toEqual([{ at: 2, name: "Beat" }]);
  });
});
