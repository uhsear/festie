# TEMPORARY (gap/ios): gate root-layout pieces behind a launch argument so one build can bisect
# the empty iOS accessibility tree. `-probeoff a,b` switches off the named pieces.
import re, sys
HDR = "import { Settings as ProbeSettings } from 'react-native';\nconst off = (k: string): boolean => String(ProbeSettings.get('probeoff') ?? '').split(',').includes(k);\n"
def sub(s, old, new, n=1):
    assert s.count(old) == n, (old, s.count(old))
    return s.replace(old, new)
p = 'app/_layout.tsx'
s = open(p, newline='').read().replace('\r\n', '\n')
s = sub(s, "import '../bootstrap';\n", "import '../bootstrap';\n" + HDR)
s = sub(s, "{!loading && <OfflineBanner", "{!loading && !off('offline') && <OfflineBanner")
s = sub(s, "{!loading && <SosBanner", "{!loading && !off('sos') && <SosBanner")
s = sub(s, "{!loading && <LiveSharePublisher", "{!loading && !off('live') && <LiveSharePublisher")
s = sub(s, "{!loading && <AnnouncementBanner", "{!loading && !off('announce') && <AnnouncementBanner")
s = sub(s, "{!loading && <Toaster />}", "{!loading && !off('toaster') && <Toaster />}")
s = sub(s, "      <ArtistSheetHost />", "      {!off('sheet') && <ArtistSheetHost />}")
s = sub(s, "<ErrorBoundary onEscape", "<EB onEscape")
s = sub(s, "</ErrorBoundary>", "</EB>")
s = sub(s, "// Hold the native splash", "const EB: any = off('eb') ? ({ children }: any) => <>{children}</> : ErrorBoundary;\n\n// Hold the native splash")
s = sub(s, "export default isExpoGo ? RootLayout", "export default isExpoGo || off('wrap') ? RootLayout")
open(p, 'w', newline='').write(s)
p = 'app/(tabs)/_layout.tsx'
s = open(p, newline='').read().replace('\r\n', '\n')
s = HDR + s
s = sub(s, "importantForAccessibility={sheetOpen ? 'no-hide-descendants' : 'auto'}", "importantForAccessibility={off('tabsview') ? undefined : sheetOpen ? 'no-hide-descendants' : 'auto'}")
open(p, 'w', newline='').write(s)
