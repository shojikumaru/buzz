# Loaded-only verification — 2026-09-13

Lane: UI. Base HEAD 8d644c70aefd063e5c4b28c64aea8005809dde9b with this branch's
working-tree delta. Runs below were NOT claimed at a future commit hash.

- Desktop full package: 6,513 passed, 0 failed, 0 skipped (DESKTOP_VERIFIED.log).
- TypeScript: `pnpm --dir desktop exec tsc --noEmit`, exit 0.
- Chromium actual AppSidebar E2E after ownership delta: 1 passed. Tested root dual
  flags, flagged reply exclusion, existing thread navigation, completion hiding,
  completed view, remove-completion restoration, live kind-5 root deletion; zero
  calls to get_thread_flag_page. This uses synthetic mock-bridge data, not a live
  Hosted relay session. Screenshots: loaded-flags-active.png/completed.png.
- Release app: `pnpm --dir desktop tauri build --features mesh-llm --bundles app`
  succeeded; ad-hoc bundle signing and `codesign --verify --deep --strict` passed.
  Main SHA256 f38b78d96ec74163345b4e57a96150636e63b23bbd2e3909471c61e99abcb6d6.
  No official Developer ID signing/notarization. Candidate not installed/restarted.
- Final repository `just ci`: exit 0. Desktop 6,513 passed; Tauri library
  3,191 passed (19 ignored); mobile 2,121 passed; workspace static checks/tests,
  desktop and web builds passed. Production fingerprints below match commit
  e98b0fe61015e8e349c9d30ef4fe68d93318dc6b after the run. Only verification docs
  are changed by the following evidence commit.

Earlier failed runs exposed test fixture/helper defects (unbound query spread,
JSDOM bidi whitespace, fabricated relay signature, duplicate mock ID, raw mock
command bypassing the UI's cache patch). All corrected, and full Desktop + E2E
rerun passed. No production algorithm was weakened to satisfy these tests.

## Production source fingerprints used by tests and app build

- `desktop/src/features/thread-flags/ThreadFlags.tsx`: `b3ff2490354ad46031c4c945c59e9fe469acd38e09527d7e751f4d6a70509a04`
- `desktop/src/features/thread-flags/useCachedQuery.ts`: `132606881c333094f8976c083defcf9d67a6943094d5251459a5cc46b7fa7e6a`
- `desktop/src/features/thread-flags/useLoadedProfiles.ts`: `3fce5b50a7d69f16efb9db1fbdb3f915b5330270ac5d754b72e99cccfc74eaeb`
- `desktop/src/features/thread-flags/loadedFlags.ts`: `d1afab4a3fc208652a034fb7fa636d52e8b0df219586d2fe9c3bb172fd4cf053`
- `desktop/src/features/channels/channelMembersKey.ts`: `dbf25a3f6a0239c3dedc28de958ff8d637df7951ffe72564ed2640c8455efa6c`
- `desktop/src/features/channels/hooks.ts`: `30b890eda085d157b15d8c8474aece6d8cd6df7312aaa053f9ad24504e0689d2`
- `desktop/src/features/sidebar/ui/AppSidebar.tsx`: `099255bb24674d7e3240db631b67a07233aebdf48ecb18fd462e15725f3d7c8c`
