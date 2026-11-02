# TESTMAP

Rust 파일::테스트명 | Go 테스트명 | 상태

> Rust 원본은 커밋 `b37365d` 의 `dev/cli-rust/` 에 있다(`git show b37365d:dev/cli-rust/src/<파일>`).

select.rs::splits_combined_reads_before_classifying | TestSplitsCombinedReadsBeforeClassifying, TestLineFeedAcceptsLikeRustNewline | 포팅 (키 분류). split_read 바이트 분할은 Bubble Tea가 소유하므로 생략
select.rs::leaves_incomplete_escape_for_the_next_read | TestLeavesIncompleteEscapeForTheNextRead | 포팅 (빈 키는 상태 불변). 불완전 이스케이프 버퍼는 Bubble Tea가 유지하므로 파서 자체는 생략
select.rs::maps_cancel_and_vim_keys | TestMapsCancelAndVimKeys | 포팅
select.rs::multi_keys_map_to_toggle_all_none_and_actions | TestMultiKeysMapToToggleAllNoneAndActions | 포팅
select.rs::nothing_is_selected_at_first_and_actions_need_a_selection | TestNothingIsSelectedAtFirstAndActionsNeedASelection | 포팅
select.rs::toggle_all_none_and_move_work_together | TestToggleAllNoneAndMoveWorkTogether | 포팅
select.rs::action_keys_return_the_selection_and_abort_returns_none | TestActionKeysReturnTheSelectionAndAbortReturnsNone | 포팅
select.rs::multi_render_shows_checkboxes_counts_and_footer | TestMultiRenderShowsCheckboxesCountsAndFooter | 포팅
args.rs::parses_list_json_and_help | TestParsesListJsonAndHelp | 포팅
args.rs::rejects_unknown_command_and_option | TestRejectsUnknownCommandAndOption | 포팅
args.rs::write_help | TestWriteHelpMatchesRust | 포팅 (원본 #[test] 없음. target/release/cli --help 평문·PTY 색 출력과 일치)
color.rs::paint_resets_when_enabled | TestPaintResetsWhenEnabled | 포팅
color.rs::paint_is_plain_when_disabled | TestPaintIsPlainWhenDisabled | 포팅
paths.rs::(없음) | — | 생략 (원본에 #[test] 없음)
lock.rs::missing_file_loads_as_empty_and_roundtrips | TestMissingFileLoadsAsEmptyAndRoundtrips | 포팅
lock.rs::corrupt_file_is_an_error | TestCorruptFileIsAnError | 포팅
lock.rs::second_guard_is_refused_until_the_first_drops | TestSecondGuardIsRefusedUntilTheFirstDrops | 포팅
manifest.rs::parses_seed_file | TestParsesSeedFile | 포팅
manifest.rs::rejects_duplicate_names | TestRejectsDuplicateNames | 포팅
manifest.rs::rejects_unknown_method | TestRejectsUnknownMethod | 포팅
manifest.rs::release_requires_repo_version_asset_checksum_bin | TestReleaseRequiresRepoVersionAssetChecksumBin | 포팅
manifest.rs::vendor_requires_url_and_bin | TestVendorRequiresUrlAndBin | 포팅
manifest.rs::bun_requires_package_and_version | TestBunRequiresPackageAndVersion | 포팅
manifest.rs::go_requires_module_and_version | TestGoRequiresModuleAndVersion | 포팅
manifest.rs::cargo_requires_package_and_version | TestCargoRequiresPackageAndVersion | 포팅
manifest.rs::non_pending_requires_version | TestNonPendingRequiresVersion | 포팅
manifest.rs::pending_allows_empty_version_and_sha256 | TestPendingAllowsEmptyVersionAndSha256 | 포팅
manifest.rs::rejects_non_https_url | TestRejectsNonHttpsUrl | 포팅
manifest.rs::exe_defaults_to_name | TestExeDefaultsToName | 포팅
verify.rs::parse_validsig_cases | TestParseValidsigCases | 포팅
verify.rs::gpg_verify_roundtrip_when_gpg_present | TestGpgVerifyRoundtripWhenGpgPresent | 포팅
resolve.rs::published_at_release_parses_published_at_only | TestPublishedAtReleaseParsesPublishedAtOnly | 포팅
resolve.rs::published_at_release_does_not_use_created_at | TestPublishedAtReleaseDoesNotUseCreatedAt | 포팅
resolve.rs::published_at_vendor_uses_last_modified | TestPublishedAtVendorUsesLastModified | 포팅
resolve.rs::published_at_vendor_missing_last_modified_is_an_error | TestPublishedAtVendorMissingLastModifiedIsAnError | 포팅
resolve.rs::published_at_go_parses_time | TestPublishedAtGoParsesTime | 포팅
resolve.rs::published_at_cargo_parses_created_at | TestPublishedAtCargoParsesCreatedAt | 포팅
resolve.rs::published_at_bun_parses_time_map | TestPublishedAtBunParsesTimeMap | 포팅
resolve.rs::release_retries_without_v_prefix_on_404 | TestReleaseRetriesWithoutVPrefixOn404 | 포팅
resolve.rs::release_does_not_retry_on_other_status | TestReleaseDoesNotRetryOnOtherStatus | 포팅
resolve.rs::go_upper_case_is_escaped | TestGoUpperCaseIsEscaped | 포팅
resolve.rs::scoped_npm_encodes_only_the_slash | TestScopedNpmEncodesOnlyTheSlash | 포팅
resolve.rs::latest_release_strips_one_v | TestLatestReleaseStripsOneV | 포팅
resolve.rs::latest_go_cargo_and_bun | TestLatestGoCargoAndBun | 포팅
resolve.rs::prerelease_detection_and_stable_pick | TestPrereleaseDetectionAndStablePick | 포팅
resolve.rs::latest_vendor_takes_first_semver_tag | TestLatestVendorTakesFirstSemverTag | 포팅
http.rs::allows_https_host_from_the_tool | TestAllowsHTTPSHostFromTheTool | 포팅
http.rs::rejects_http | TestRejectsHTTP | 포팅
http.rs::rejects_arbitrary_host | TestRejectsArbitraryHost | 포팅
http.rs::rejects_explicit_port | TestRejectsExplicitPort | 포팅
http.rs::matches_host_case_insensitively | TestMatchesHostCaseInsensitively | 포팅
http.rs::rejects_lookalike_suffix_host | TestRejectsLookalikeSuffixHost | 포팅
http.rs::rejects_userinfo_even_when_it_looks_like_the_host | TestRejectsUserinfoEvenWhenItLooksLikeTheHost | 포팅
http.rs::vendor_without_repo_allows_only_url_hosts | TestVendorWithoutRepoAllowsOnlyURLHosts | 포팅
http.rs::method_fixed_hosts_and_distinct_sig_host | TestMethodFixedHostsAndDistinctSigHost | 포팅
http.rs::localhost_test_exception_is_exact_port | TestLocalhostTestExceptionIsExactPort | 포팅 (추가로 포트 99999는 invalid url)
http.rs::invalid_token_is_not_copied_into_the_error | TestInvalidTokenIsNotCopiedIntoTheError | 포팅

checksum.rs::parses_sha256sum_lines | TestParsesSha256sumLines | 포팅
checksum.rs::single_hash_file_ignores_asset_name | TestSingleHashFileIgnoresAssetName | 포팅
checksum.rs::verify_sha256_match_and_mismatch | TestVerifySha256MatchAndMismatch | 포팅
cooldown.rs::parses_rfc3339_and_http_date | TestParsesRfc3339AndHttpDate | 포팅
cooldown.rs::cooldown_boundary_is_inclusive_and_future_fails | TestCooldownBoundaryIsInclusiveAndFutureFails | 포팅
pin.rs::pins_one_tool_and_keeps_comments_and_the_other_tool | TestPinsOneToolAndKeepsCommentsAndTheOtherTool | 포팅
pin.rs::rejects_bad_hash_and_unknown_tool | TestRejectsBadHashAndUnknownTool | 포팅
pkg.rs::bun_install_ignores_scripts_and_sets_the_cooldown_in_seconds | TestBunInstallIgnoresScriptsAndSetsTheCooldownInSeconds | 포팅
pkg.rs::go_install_pins_the_version_and_targets_the_prefix_bin | TestGoInstallPinsTheVersionAndTargetsThePrefixBin | 포팅
pkg.rs::cargo_install_is_locked_and_rooted_at_the_prefix | TestCargoInstallIsLockedAndRootedAtThePrefix | 포팅
pkg.rs::bun_lock_integrity_reads_the_hash_after_the_entry | TestBunLockIntegrityReadsTheHashAfterTheEntry | 포팅
pkg.rs::go_removal_refuses_paths_outside_the_bin_dir | TestGoRemovalRefusesPathsOutsideTheBinDir | 포팅
gate.rs::checksum_match_passes_at_checksum_level | TestChecksumMatchPassesAtChecksumLevel | 포팅
gate.rs::young_release_is_blocked_by_cooldown | TestYoungReleaseIsBlockedByCooldown | 포팅
gate.rs::tampered_artifact_is_blocked | TestTamperedArtifactIsBlocked | 포팅
gate.rs::checksum_file_without_the_asset_is_blocked | TestChecksumFileWithoutTheAssetIsBlocked | 포팅
gate.rs::release_without_any_verification_is_blocked | TestReleaseWithoutAnyVerificationIsBlocked | 포팅
gate.rs::vendor_without_pin_asks_for_approval | TestVendorWithoutPinAsksForApproval | 포팅
gate.rs::vendor_pinned_hash_passes_and_mismatch_blocks | TestVendorPinnedHashPassesAndMismatchBlocks | 포팅
gate.rs::pin_must_still_match_when_a_checksum_also_passes | TestPinMustStillMatchWhenAChecksumAlsoPasses | 포팅
gate.rs::signed_checksum_file_gives_sig_level_and_bad_sig_blocks | TestSignedChecksumFileGivesSigLevelAndBadSigBlocks | 포팅
gate.rs::(없음) | TestGateBlocksHostViolation | 포팅 (신규)
gate.rs::(없음) | TestGateBlocksBlankPinAndMissingFingerprint | 포팅 (신규)
gate.rs::(없음) | TestGateBlocksMissingArtifactAsIo | 포팅 (신규)
audit.rs::parses_only_vulnerable_packages_once | TestParsesOnlyVulnerablePackagesOnce | 포팅
audit.rs::osv_args_pick_the_binary_plugin_or_a_lockfile | TestOsvArgsPickTheBinaryPluginOrALockfile | 포팅
audit.rs::policy_flags_unverifiable_vendor_pending_and_unknown_lock_entries | TestPolicyFlagsUnverifiableVendorPendingAndUnknownLockEntries | 포팅
audit.rs::exit_code_is_2_for_vulns_or_errors_only_when_nothing_else | TestExitCodeIs2ForVulnsOrErrorsOnlyWhenNothingElse | 포팅
audit.rs::a_fake_osv_scanner_with_a_known_vulnerable_module_yields_code_2 | TestAFakeOsvScannerWithAKnownVulnerableModuleYieldsCode2 | 포팅 (가짜 osv 실행파일. 실제 osv-scanner 미실행)
audit.rs::osv_failure_is_reported_as_an_error_not_a_finding | TestOsvFailureIsReportedAsAnErrorNotAFinding | 포팅 (가짜 실행파일 exit 7)
http_redirect.rs::redirect_to_disallowed_host_fails_before_connect | TestRedirectToDisallowedHostFailsBeforeConnect | 포팅
http_redirect.rs::redirect_to_allowed_host_succeeds | TestRedirectToAllowedHostSucceeds | 포팅
http_redirect.rs::download_writes_part_then_renames | TestDownloadWritesPartThenRenames | 포팅
http_redirect.rs::download_404_is_an_error_and_leaves_no_part | TestDownload404IsAnErrorAndLeavesNoPart | 포팅
http_redirect.rs::redirect_cap_stops_at_five_hops | TestRedirectCapStopsAtFiveHops | 포팅
http_redirect.rs::localhost_request_does_not_send_github_token | TestLocalhostRequestDoesNotSendGithubToken | 포팅
plugin.rs::release_plugin_uses_the_real_tag_shape | TestReleasePluginUsesTheRealTagShape | 포팅
plugin.rs::tag_without_the_version_is_rejected | TestTagWithoutTheVersionIsRejected | 포팅
plugin.rs::vendor_plugin_keeps_the_file_name_and_exe_path | TestVendorPluginKeepsTheFileNameAndExePath | 포팅
plugin.rs::protolock_hash_handles_plain_and_gpg_records | TestProtolockHashHandlesPlainAndGpgRecords | 포팅
engine.rs::install_always_pins_globally_from_the_cli_home | TestInstallAlwaysPinsGloballyFromTheCliHome | 포팅
engine.rs::plugin_is_registered_in_the_global_config | TestPluginIsRegisteredInTheGlobalConfig | 포팅
engine.rs::inherited_version_overrides_are_detected | TestInheritedVersionOverridesAreDetected | 포팅
install.rs::remove_uninstalls_unregisters_and_forgets | TestRemoveUninstallsUnregistersAndForgets | 포팅
install.rs::remove_dry_run_changes_nothing | TestRemoveDryRunChangesNothing | 포팅
install.rs::remove_without_tty_or_yes_is_refused_and_changes_nothing | TestRemoveWithoutTtyOrYesIsRefusedAndChangesNothing | 포팅
install.rs::remove_of_an_unrecorded_tool_is_refused | TestRemoveOfAnUnrecordedToolIsRefused | 포팅
install.rs::a_second_cli_holding_the_lock_blocks_remove_before_anything_changes | TestASecondCliHoldingTheLockBlocksRemoveBeforeAnythingChanges | 포팅
update.rs::same_version_is_latest | TestSameVersionIsLatest | 포팅
update.rs::newer_old_enough_is_an_update_and_too_new_waits | TestNewerOldEnoughIsAnUpdateAndTooNewWaits | 포팅
update.rs::lookup_failures_are_unknown_not_errors | TestLookupFailuresAreUnknownNotErrors | 포팅
update.rs::rollback_without_a_previous_version_is_refused | TestRollbackWithoutAPreviousVersionIsRefused | 포팅
doctor.rs::classifies_ok_unmanaged_missing_and_conflicts_without_reading_env_values | TestClassifiesOkUnmanagedMissingAndConflictsWithoutReadingEnvValues | 포팅
doctor.rs::installed_without_a_lock_entry_is_unmanaged_not_a_problem | TestInstalledWithoutALockEntryIsUnmanagedNotAProblem | 포팅
doctor.rs::a_failing_probe_is_a_problem | TestAFailingProbeIsAProblem | 포팅
doctor.rs::table_output_collapses_to_the_first_data_row | TestTableOutputCollapsesToTheFirstDataRow | 포팅
doctor.rs::probe_returns_the_first_line_and_none_on_failure | TestProbeReturnsTheFirstLineAndNoneOnFailure | 포팅 (sh -c 대신 임시 실행 파일. 인자 배열만. stderr 한 줄 확인 추가)
doctor.rs::(없음) | TestProtoCopiesAreNotPathDuplicates | 추가 (proto shims·bin 은 PATH 중복이 아님)
doctor.rs::(없음) | TestDoctorRenderUsesRustMarks | 추가 (render 마크·env 줄·요약. 원본 #[test] 없음)
lib.rs::finds_executable_on_path_only | TestFindsExecutableOnPathOnly | 포팅
lib.rs::list_json_uses_manifest_version_or_null | TestListJSONUsesManifestVersionOrNull | 포팅
lib.rs::failures_keep_going_and_report_the_heaviest_code | TestFailuresKeepGoingAndReportTheHeaviestCode | 포팅
lib.rs::picker_keys_map_to_actions | TestPickerKeysMapToActions | 포팅
lib.rs::picker_groups_tools_by_category_with_install_state | TestPickerGroupsToolsByCategoryWithInstallState | 포팅
lib.rs::picker_actions_map_to_install_remove_and_update_variants | TestPickerActionsMapToInstallRemoveAndUpdateVariants | 포팅
lib.rs::install_and_remove_need_a_name_and_a_known_tool | TestInstallAndRemoveNeedANameAndAKnownTool | 포팅
