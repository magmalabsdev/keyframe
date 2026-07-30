import { describe, it, expect, beforeEach } from 'vitest';
import { getActiveScene, undo, useDocumentStore } from './documentStore';
import { createDefaultProject } from './defaults';

const api = () => useDocumentStore.getState();
const markers = () => getActiveScene(api().project).markers ?? [];

describe('documentStore marker actions', () => {
  beforeEach(() => {
    api().setProject(createDefaultProject());
    useDocumentStore.temporal.getState().clear();
  });

  it('adds markers kept sorted by time', () => {
    api().addMarker(2000);
    api().addMarker(500);
    api().addMarker(1000);
    expect(markers().map((m) => m.timeMs)).toEqual([500, 1000, 2000]);
  });

  it('names and colors markers automatically', () => {
    api().addMarker(0);
    api().addMarker(1000, 'Chorus');
    expect(markers()[0].name).toBe('Marker 1');
    expect(markers()[1].name).toBe('Chorus');
    expect(markers()[0].color).not.toBe(markers()[1].color);
  });

  it('ignores a second marker at the same time', () => {
    // Pressing M twice at one spot should not stack invisible duplicates.
    api().addMarker(1000);
    api().addMarker(1000);
    api().addMarker(1000.5);
    expect(markers()).toHaveLength(1);
  });

  it('renames and recolors', () => {
    api().addMarker(1000);
    const id = markers()[0].id;
    api().renameMarker(id, 'Beat drop');
    api().setMarkerColor(id, '#ff0000');
    expect(markers()[0].name).toBe('Beat drop');
    expect(markers()[0].color).toBe('#ff0000');
  });

  it('moves a marker and re-sorts', () => {
    api().addMarker(1000);
    api().addMarker(2000);
    const first = markers()[0].id;
    api().moveMarker(first, 3000);
    expect(markers().map((m) => m.timeMs)).toEqual([2000, 3000]);
  });

  it('clamps a moved marker to the scene', () => {
    api().addMarker(1000);
    const id = markers()[0].id;
    api().moveMarker(id, -500);
    expect(markers()[0].timeMs).toBe(0);
    api().moveMarker(id, 999_999);
    expect(markers()[0].timeMs).toBe(getActiveScene(api().project).durationMs);
  });

  it('removes a marker', () => {
    api().addMarker(1000);
    api().removeMarker(markers()[0].id);
    expect(markers()).toHaveLength(0);
  });

  it('is undoable (markers live in the document, not editor state)', () => {
    api().addMarker(1000);
    expect(markers()).toHaveLength(1);
    api().removeMarker(markers()[0].id);
    expect(markers()).toHaveLength(0);
    undo();
    expect(markers()).toHaveLength(1);
  });
});
