import test from 'node:test';
import assert from 'node:assert/strict';
import { projectToMidiBlob, snippetToMidiBlob } from '../../src/export/MidiExporter.js';

async function parseMidi(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const tracks = [];
  let position = 14;
  const variable = () => {
    let value = 0;
    let byte;
    do { byte = bytes[position++]; value = value * 128 + (byte & 127); } while (byte & 128);
    return value;
  };
  while (position < bytes.length) {
    assert.equal(new TextDecoder().decode(bytes.slice(position, position + 4)), 'MTrk');
    const end = position + 8 + view.getUint32(position + 4);
    position += 8;
    let tick = 0;
    const events = [];
    while (position < end) {
      tick += variable();
      const status = bytes[position++];
      if (status === 255) {
        const type = bytes[position++];
        const length = variable();
        events.push({ tick, status, type, data: Array.from(bytes.slice(position, position + length)) });
        position += length;
      } else {
        assert.ok([0x80, 0x90, 0xb0].includes(status & 0xf0));
        events.push({ tick, status, data: [bytes[position++], bytes[position++]] });
      }
    }
    tracks.push(events);
  }
  assert.equal(view.getUint16(10), tracks.length);
  return { format: view.getUint16(8), tracks };
}

const snippet = { type: 'midi', notes: [{ pitch: 60, startTick: 0, durationTick: 480, velocity: 0.8 }] };
const nameOf = track => new TextDecoder().decode(Uint8Array.from(track.find(event => event.type === 3).data));
const ons = track => track.filter(event => (event.status & 0xf0) === 0x90);

test('Canvas MIDI exports named format-1 tracks with separate melodic channels and percussion on 10', async () => {
  const { format, tracks } = await parseMidi(projectToMidiBlob({ bpm: 120, tracks: [
    { name: 'Piano été', type: 'midi', volume: 0, pan: -1, clips: [{ snippet, startBar: 1, timeScale: 2 }] },
    { name: 'Lead', type: 'midi', clips: [{ snippet }] },
    { name: 'Beat', type: 'drum', clips: [{ snippet: { type: 'drum', hits: [{ type: 'kick', startTick: 0 }] } }] },
    { name: 'Muted', type: 'midi', muted: true, clips: [{ snippet }] },
  ] }));
  assert.equal(format, 1);
  assert.equal(tracks.length, 4);
  assert.deepEqual(tracks.slice(1).map(nameOf), ['Piano été', 'Lead', 'Beat']);
  assert.deepEqual(tracks.slice(1).map(track => ons(track)[0].status & 15), [0, 1, 9]);
  assert.equal(ons(tracks[1])[0].tick, 1920);
  assert.equal(tracks[1].find(event => event.status === 0x80).tick, 2880);
  assert.ok(tracks[1].some(event => event.status === 0xb0 && event.data[0] === 7 && event.data[1] === 0));
  assert.ok(tracks[0].some(event => event.type === 0x51));
});

test('MIDI keeps solo filtering, note-off ordering and intentional zero velocity', async () => {
  const { tracks } = await parseMidi(projectToMidiBlob({ tracks: [
    { name: 'Solo', solo: true, type: 'midi', clips: [{ snippet }] },
    { name: 'Other', type: 'midi', clips: [{ snippet }] },
  ] }));
  assert.equal(tracks.length, 2);
  const single = await parseMidi(snippetToMidiBlob({ type: 'midi', notes: [
    ...snippet.notes, { pitch: 60, startTick: 480, durationTick: 480, velocity: 0.8 },
    { pitch: 64, startTick: 0, durationTick: 480, velocity: 0 },
  ] }));
  assert.equal(single.format, 0);
  assert.equal(ons(single.tracks[0]).length, 2);
  assert.deepEqual(single.tracks[0].filter(event => event.tick === 480).map(event => event.status), [0x80, 0x90]);
});
