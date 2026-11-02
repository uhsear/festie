import { Alert } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { DATA_COPY } from '@festie/shared/constants';
import { fetchAccountExport } from '@festie/shared/services';

/**
 * Fetches GET /account/export, writes it to a JSON file in the cache directory and opens
 * the OS share sheet. Errors propagate; callers show `exportErrorMessage(err)`.
 */
export async function shareAccountExport(): Promise<void> {
  const data = await fetchAccountExport();
  const json = JSON.stringify(data, null, 2);

  // One fixed filename, overwritten each export. A timestamped name left a
  // fresh full-account JSON bundle in the cache on every tap, forever —
  // a privacy footgun. Overwriting keeps at most one copy on disk.
  const file = new File(Paths.cache, 'festie-data-export.json');
  file.create({ overwrite: true });
  file.write(json);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: DATA_COPY.shareTitle,
    });
  } else {
    Alert.alert(DATA_COPY.done, file.uri);
  }
}
