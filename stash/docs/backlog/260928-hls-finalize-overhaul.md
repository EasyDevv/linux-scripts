# HLS segment 100% failed → finalize 파이프라인 전면 개편

2026-09-27 ~ 2026-09-28에 걸친 작업 기록. `http://stash.localhost/`에서 HLS segment가
100% 다운로드된 상태로 `failed` 처리되는 문제에서 시작해, 두 다운로드 경로
(reqwest-HLS / browser-hls) 모두의 finalize(mux) 방식을 바꿨다. 근본 원인 분석과
MPMux 확장 분석은 [[260927-mpmux-and-finalize-failures.md]]에 상세 기록, 이 문서는
전체 변경사항의 참고용 요약 + 이후 이어서 한 browser-hls 스트리밍 포팅 기록.

관련 코드: `src/downloads.rs`, `src/main.rs`, `src/hls.rs`, `src/worker.rs`,
`src/browser_hls_stream.rs`(신규)

## 한 줄 요약

1. **P0 — 파일명 바이트 길이 캡 누락**이 "100% failed"의 실제 원인이었다(재배포
   타이밍 문제라는 이전 진단은 부수적 요인). `sanitize_filename`류에 truncate 추가.
2. **P1/P2 — raw byte concat은 시도했다가 되돌렸다.** MissAV/surrit TS는 세그먼트마다
   PTS가 리셋돼서, byte concat하면 duration이 깨진다(직접 재현: 60초가 15초로 붕괴).
   concat demuxer(파일별 입력)만 안전.
3. **reqwest-HLS 경로**: named-pipe 스트리밍 mux의 상한이 128세그먼트였던 진짜
   이유는 pipe 디렉터리가 NFS(`/mnt/shared`) 위에 있어서였다(측정: NFS mkfifo가
   로컬 대비 12배 느림). pipe를 로컬(`/var/tmp/stash-mux-pipes`)로 옮기고 상한을
   8,192로 올려 실제 실패 사례(1,600~1,900 세그먼트) 규모도 전부 스트리밍하게 함.
4. **browser-hls 경로(확장이 쓰는 경로)**: 원래 "전부 업로드 → 한 번에 batch mux"만
   있었는데, 3번과 같은 named-pipe 스트리밍을 이식했다. HTTP 업로드로 세그먼트가
   들어오는 구조라 reqwest 경로처럼 단일 소유 태스크가 없어서, 별도 registry +
   staleness sweep이 필요했다(아래 "browser-hls 스트리밍 이식" 참고).

## 검증된 것 / 안 된 것

실서버(port 45122)에 synthetic HLS job을 직접 만들어(각 세그먼트를 독립
인코딩 — 실제 HLS처럼 세그먼트마다 PTS가 리셋되는 조건) 종단 검증:

| 경로 | 세그먼트 수 | mux_wall | duration 정확도 |
|---|---|---|---|
| reqwest-HLS 스트리밍 | 300 | 4.31ms | 600.04s (기대 600s) |
| browser-hls 스트리밍(신규) | 300 | 12.04ms | 613.0s (기대 ~600~613s, 세그먼트별 실제 인코딩 길이 편차) |

둘 다 gap 검출(중간 세그먼트 누락 시 명시적 실패) + 이후 재업로드로 자가 복구되는
것도 실서버에서 확인. `cargo test` 119개 통과.

**안 된 것**: `browser_hls_stream::sweep_stale`(스트리밍 mux가 걸린 채 업로드가
멈춘 job을 정리하는 워치독)는 유닛 테스트로만 검증했다 — 실제 300초
`stale_timeout_secs` 타이머를 라이브로 기다려서 확인하지는 않음. 로직은
`worker.rs`의 기존 `stale_browser_hls_cleanup`과 같은 주기(기본 60초)로 돌게
연결해뒀다.

## 시행착오: 테스트 픽스처가 진짜 버그처럼 보였던 사례

browser-hls gap-test를 처음 돌릴 때 임의 바이트 오프셋으로 하나의 TS를 4조각으로
쪼갠 픽스처를 재사용했다(이전 raw-concat 재현 테스트와 같은 방식). 그 결과
누락 세그먼트를 나중에 채워 넣었을 때 `open named pipe timed out`으로 120초 만에
실패 — 실제 코드 버그처럼 보였다. 원인은 픽스처였다: 임의 오프셋 분할은 188바이트
패킷 경계와 무관해서, concat demuxer가 **파일**로 열 때는 관대하게(seek 가능)
복구하지만 **named pipe**로 열 때는(순차 접근만 가능) 첫 패킷 sync를 못 찾고
ffmpeg가 조용히 죽어버렸다 — 그 뒤로 아무도 다음 pipe를 열지 않아 feeder가
타임아웃. 독립 인코딩된(패킷 정렬이 보장되는) 세그먼트로 다시 만드니 정상
동작. **결론: HLS 세그먼트를 흉내 낼 땐 반드시 독립적으로 인코딩된 완전한 TS를
써야 한다 — 실제 세그먼터가 항상 패킷 경계에서 자르는 것과 같은 조건.** 바이트
오프셋 분할은 (raw concat 재현처럼) 원본을 정확히 복원하는 검증에만 쓸 것.

## browser-hls 스트리밍 이식 — 설계

reqwest-HLS 경로는 `run_job` 하나의 async 태스크가 다운로드부터 mux까지 다
소유해서, pipe feeder나 stall 감시를 그 태스크 흐름 안에서 자연스럽게 할 수
있다. browser-hls는 세그먼트가 독립적인 HTTP PUT 요청들로 들어오고, `complete`가
아예 호출되지 않을 수도 있어서(브라우저 탭이 죽는 등) 별도 상태 관리가 필요했다.

### `src/browser_hls_stream.rs` (신규 모듈)

```rust
pub struct StreamingMux {
    pub child: Option<Child>,
    pub feeder: Option<JoinHandle<Result<(), String>>>,
    pub tx: Option<UnboundedSender<PathBuf>>,
    pub pipe_dir: PathBuf,
    pub staged_path: PathBuf,
    pub next_feed_index: u64,
}
pub type Registry = Arc<StdMutex<HashMap<String, Arc<AsyncMutex<StreamingMux>>>>>;
```

- **registry에 항목이 있다 = 이 job이 스트리밍 중이다.** 없으면 `upload`/`complete`
  둘 다 조용히 기존 batch 경로로 빠진다 — 항상 안전한 폴백.
- `feed_ready_segments`: `next_feed_index`부터 연속으로 존재하는
  `segment-{n:06}.ts`를 찾아 pipe feeder에 보낸다. gap을 만나면 멈춘다. 매
  업로드마다, 그리고 `complete` 진입 시 한 번 더 호출(막판에 도착한 세그먼트
  캐치업용).
- `child`/`feeder`/`tx`가 전부 `Option`인 이유: `&mut` 접근만으로 개별 필드를
  `.take()`해서 넘길 수 있게(전체 struct 소유권 없이) — registry에서 꺼낸
  `Arc<AsyncMutex<..>>`는 동시에 다른 요청이 clone을 쥐고 있을 수 있어서 전체
  소유권 이전이 어렵다.
- `sweep_stale`: registry의 job_id들을 순회해 job 상태/`updated_at`이 stale이면
  `child.kill()` + feeder abort + pipe_dir 삭제. `worker.rs`의
  `run_browser_hls_worker` 루프에서 기존 `stale_browser_hls_cleanup` 직후 같은
  주기로 호출 — AppState 전체를 worker.rs에 넘기지 않고 이 registry(및
  `Arc<JobManager>`, threshold 값)만 넘기면 되게 분리했다.

### `main.rs` 쪽 연결

- `AppState.browser_hls_streaming: browser_hls_stream::Registry` 추가.
- `try_start_browser_hls_streaming`: `total_segments`가 처음 확정되는 시점
  (`create_browser_hls_job`의 `segment_count`, 또는 `set_browser_hls_total_segments`)에
  호출. `total_segments == 0` 이거나 `STREAMING_MUX_MAX_SEGMENTS`(8,192) 초과면
  즉시 반환(batch 유지) — pipe 생성/ffmpeg spawn 실패 시에도 그냥 batch로
  fallback(세그먼트 파일은 어차피 디스크에 그대로 쓰이므로 데이터 유실 없음).
- `upload_browser_hls_segment`: 파일 쓰기 후 registry에서 자기 job의 mux를
  찾아 `feed_ready_segments` 호출(있으면).
- `complete_browser_hls_job`: registry에서 `remove`(소유권 이전). 불완전하면
  다시 `insert`해서 이후 업로드가 계속 피드할 수 있게 해준 뒤 에러 반환. 완전하면
  `tx` drop(EOF 신호) → feeder join → `downloads::monitor_ffmpeg_mux(child, ...)`로
  마무리 — reqwest 경로와 동일한 종료 시퀀스.
- `downloads.rs`의 `create_named_pipe`, `feed_segment_pipes`, `monitor_ffmpeg_mux`,
  `MUX_PIPE_LOCAL_ROOT`, `STREAMING_MUX_MAX_SEGMENTS`를 `pub(crate)`로 열어 재사용
  (중복 구현 대신).

## 남은 것

- `sweep_stale`의 실제 5분 타임아웃 경로는 라이브 타이머로 검증 안 됨(로직
  리뷰 + 유닛 테스트만).
- CDP 워커(port 12345)는 이번에도 안 건드림 — 필요 시 별도로 기동.
- 두 경로 모두 `STREAMING_MUX_MAX_SEGMENTS`(8,192) 초과 시 여전히 batch mux —
  6s/segment 기준 13시간 초과하는 영상만 해당, 사실상 안전망.
