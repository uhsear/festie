// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// Festival profile creation shared by POST /profiles and POST /crews/join, so
// both apply the same orphan-claim and per-festival profile-cap rules. Joining a
// crew creates the profile in the crew's festival on the server, which serves
// web, mobile and offline replays from one place.

export type EnsureFestivalProfileResult =
  | { profile: any; user: any; error?: undefined }
  | { error: 'limit' }
  | { error: 'user-missing' };

export async function ensureFestivalProfile(
  deps: any,
  reqUser: { userId: string; username: string },
  festivalId: string,
): Promise<EnsureFestivalProfileResult> {
  const { config, log, getUserFestivalProfile, getUserById, getProfiles, createOpaqueId, emitter, stores } = deps;

  // Check if user already has profile for this festival
  let profile = await getUserFestivalProfile(reqUser.userId, festivalId);
  if (profile) {
    const user = await getUserById(profile.userId);
    if (!user) return { error: 'user-missing' };
    emitter.profileCreated({ festivalId, profile, user });
    return { profile, user };
  }

  // Try to claim orphan profile matching username
  profile = await stores.profiles.claimOrphan(festivalId, reqUser.userId, reqUser.username);
  if (profile) {
    const user = await getUserById(profile.userId);
    if (!user) return { error: 'user-missing' };
    emitter.profileCreated({ festivalId, profile, user });
    return { profile, user };
  }

  // Check max profiles per festival — use countByFestival if available, else fallback
  const festivalProfileCount = stores.profiles.countByFestival
    ? await stores.profiles.countByFestival(festivalId)
    : (await getProfiles()).filter((p: any) => p.festivalId === festivalId).length;
  if (festivalProfileCount >= config.MAX_PROFILES_PER_FESTIVAL) {
    return { error: 'limit' };
  }

  // Create new profile
  profile = await stores.profiles.create({
    id: createOpaqueId('prof'),
    festivalId,
    userId: reqUser.userId,
    name: reqUser.username,
    picks: {},
    notes: {},
    reminders: {},
    createdAt: new Date().toISOString(),
  });

  const user = await getUserById(profile.userId);
  if (!user) return { error: 'user-missing' };
  log.info('profile:created', { profileId: profile.id, festivalId, userId: reqUser.userId, username: reqUser.username });
  emitter.profileCreated({ festivalId, profile, user });
  return { profile, user };
}
