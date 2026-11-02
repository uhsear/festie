// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { Redirect } from 'expo-router';

// The Find hub moved into the Map tab; old festie://find links land there.
export default function Find() {
  return <Redirect href="/map" />;
}
