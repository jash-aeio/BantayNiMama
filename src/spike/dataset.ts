import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { MODEL_ID } from './config';
import type { Shot } from './vectors';

/** One recorded live frame with its ground truth, for offline scoring. */
export interface TestFrame {
  trueLabel: string;
  vector: number[];
  elapsedMs: number;
  at: number;
}

export interface SpikeDataset {
  modelId: string;
  dim: number;
  device: string;
  shots: Shot[];
  frames: TestFrame[];
}

/**
 * TR-43 in spirit: everything lives under the document directory and is named
 * relatively, so the export is one self-contained file.
 */
const DATASET = new File(Paths.document, 'spike-dataset.json');
const PHOTOS = new Directory(Paths.document, 'photos');

export function emptyDataset(device: string): SpikeDataset {
  return { modelId: MODEL_ID, dim: 0, device, shots: [], frames: [] };
}

export function load(device: string): SpikeDataset {
  if (!DATASET.exists) return emptyDataset(device);
  try {
    return JSON.parse(DATASET.textSync()) as SpikeDataset;
  } catch {
    return emptyDataset(device);
  }
}

export function save(data: SpikeDataset): void {
  if (!DATASET.exists) DATASET.create({ intermediates: true });
  DATASET.write(JSON.stringify(data));
}

export function photosDir(): Directory {
  if (!PHOTOS.exists) PHOTOS.create({ intermediates: true });
  return PHOTOS;
}

/** Folder picked earlier this session, so repeat backups do not re-open the picker. */
let backupFolder: Directory | null = null;

/**
 * Copies the dataset into a folder the operator picks with the system folder
 * picker. Exists because the share sheet can offer no local target at all — on
 * the Infinix X6823 every option is Bluetooth, a phone-to-phone app or an
 * uploader (TR-50). Each copy gets a timestamped name, so a backup is never
 * overwritten by a later one.
 */
export async function saveDatasetToFolder(): Promise<string> {
  if (!DATASET.exists) throw new Error('No dataset recorded yet.');
  const content = DATASET.textSync();
  const name = `spike-dataset-${timestamp(new Date())}.json`;

  if (backupFolder !== null) {
    try {
      return writeCopy(backupFolder, name, content);
    } catch {
      backupFolder = null; // access lapsed or the folder was deleted — ask again
    }
  }
  backupFolder = await Directory.pickDirectoryAsync();
  return writeCopy(backupFolder, name, content);
}

function writeCopy(folder: Directory, name: string, content: string): string {
  const file = folder.createFile(name, 'application/json');
  file.write(content);
  return `${folder.name}/${file.name}`;
}

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * The only way off a non-rooted Android phone without a network call: hand the
 * file to the system share sheet and let the operator drop it wherever they can
 * reach it from the laptop (USB, SD card, local file manager).
 */
export async function exportDataset(): Promise<void> {
  if (!DATASET.exists) throw new Error('No dataset recorded yet.');
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(`Sharing unavailable. File is at: ${DATASET.uri}`);
  }
  await Sharing.shareAsync(DATASET.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Export Phase 0 dataset',
  });
}
