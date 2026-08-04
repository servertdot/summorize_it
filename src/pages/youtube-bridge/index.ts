const REQUEST_EVENT = 'summarize-it:request-youtube-page';
const RESPONSE_ATTRIBUTE = 'data-summarize-it-youtube-page';

interface YouTubePlayer {
  getPlayerResponse?: () => unknown;
  getOption?: (namespace: string, option: string) => unknown;
  getVideoData?: () => { video_id?: string; title?: string };
}

window.addEventListener(REQUEST_EVENT, () => {
  const player = document.querySelector<HTMLElement>('#movie_player') as HTMLElement & YouTubePlayer | null;
  const videoData = player?.getVideoData?.();
  const rawResponse = player?.getPlayerResponse?.() as Record<string, unknown> | undefined
    ?? (window as Window & { ytInitialPlayerResponse?: Record<string, unknown> }).ytInitialPlayerResponse;
  const rawActiveCaption = player?.getOption?.('captions', 'track') as { vssId?: string; languageCode?: string } | undefined;
  const snapshot = {
    videoId: videoData?.video_id,
    title: videoData?.title,
    activeCaption: rawActiveCaption ? {
      vssId: rawActiveCaption.vssId,
      languageCode: rawActiveCaption.languageCode,
    } : undefined,
    playerResponse: minimizePlayerResponse(rawResponse),
  };
  document.documentElement.setAttribute(RESPONSE_ATTRIBUTE, JSON.stringify(snapshot));
  window.dispatchEvent(new CustomEvent(`${REQUEST_EVENT}:ready`));
});

function minimizePlayerResponse(response?: Record<string, unknown>): unknown {
  if (!response) return undefined;
  const typed = response as {
    videoDetails?: { videoId?: string; title?: string };
    playabilityStatus?: { status?: string; reason?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } };
  };
  return {
    videoDetails: {
      videoId: typed.videoDetails?.videoId,
      title: typed.videoDetails?.title,
    },
    playabilityStatus: {
      status: typed.playabilityStatus?.status,
      reason: typed.playabilityStatus?.reason,
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: typed.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [],
      },
    },
  };
}
