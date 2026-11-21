# Cut a festival-area PMTiles extract

Use this procedure to make the offline basemap file for one festival. The file is a small slice of a Protomaps build. It holds only the festival area.

## Before you start

- Install the `pmtiles` command line tool from the go-pmtiles releases (https://github.com/protomaps/go-pmtiles/releases).
- Choose a Protomaps build. Protomaps publishes daily planet builds as `.pmtiles` files (https://docs.protomaps.com/basemaps/downloads). Use a region build when you have one, because it is smaller to read.
- Find the bounding box of the festival site as `west,south,east,north` in decimal degrees. Add a margin of 1 to 2 km so the map does not end at the fence.

## Cut the extract

1. Run the extract. Replace the source with the URL or local path of the build.

   ```sh
   pmtiles extract <source-build.pmtiles> fest-2026.pmtiles \
     --bbox=<west>,<south>,<east>,<north> \
     --maxzoom=15
   ```

   `pmtiles` reads only the byte ranges it needs from a remote source. A site of a few kilometres at zoom 15 is typically a few tens of megabytes.

2. Check the file.

   ```sh
   pmtiles show fest-2026.pmtiles
   ```

   The output must list the bounds you asked for and a tile count above zero.

3. Name the file with lowercase letters, digits, `_` and `-` only, then `.pmtiles`. Examples: `fest-2026.pmtiles`. The server refuses any other name.

## Place the file

1. Copy the file into the directory that `TILES_DIR` names on the server. Do not overwrite a file that clients may already have cached.
2. Use a new file name for each re-extract, for example `fest-2026-b.pmtiles`. The server marks files as immutable for one year, so a changed file under an old name stays stale in browsers and in the app.
3. Check that the server serves it. The request must answer `206` with a `Content-Range` header.

   ```sh
   curl -s -o /dev/null -D - -H "Range: bytes=0-99" https://<app-host>/tiles/fest-2026.pmtiles
   ```

## Point the festival at the file

1. Open the festival in the admin map editor.
2. Open the "Offline map" panel and enter `/tiles/fest-2026.pmtiles`. The server stores it as an absolute https URL on the app origin.
3. Save. Phones and browsers then show a "Download map for offline" action with the file size.

To stop using the file, clear the field and save. The map then uses the online basemap again.

## Attribution

Protomaps builds use OpenStreetMap data. Enter `© OpenStreetMap contributors` in the attribution field of the panel.
