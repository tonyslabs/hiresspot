package io.drskxll.hiresspot;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

/**
 * Puente entre el motor de reproducción (JS) y el ExoPlayer del servicio. Mantiene como máximo dos elementos
 * en la lista nativa —la pista actual y la siguiente— para que el cambio al terminar sea inmediato y siga
 * ocurriendo aunque el WebView esté suspendido con la pantalla apagada.
 */
@CapacitorPlugin(name = "NativeAudio")
public class NativeAudioPlugin extends Plugin {
    private static final long PROGRESS_MS = 500;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Runnable> pending = new ArrayList<>();
    private ExoPlayer exo;
    private MediaController controller;
    private boolean listening = false;

    private final Runnable progress = new Runnable() {
        @Override
        public void run() {
            if (exo != null && exo.isPlaying()) {
                emitState();
                main.postDelayed(this, PROGRESS_MS);
            }
        }
    };

    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            emitState();
            main.removeCallbacks(progress);
            if (isPlaying) main.postDelayed(progress, PROGRESS_MS);
        }

        @Override
        public void onPlaybackStateChanged(int state) {
            emitState();
        }

        @Override
        public void onMediaItemTransition(MediaItem item, int reason) {
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO && item != null) {
                JSObject o = new JSObject();
                o.put("url", item.mediaId);
                notifyListeners("transition", o, true);
                emitState();
            }
        }

        @Override
        public void onPlayerError(@NonNull PlaybackException error) {
            JSObject o = new JSObject();
            o.put("message", error.getErrorCodeName() + (error.getMessage() != null ? ": " + error.getMessage() : ""));
            o.put("code", error.errorCode);
            notifyListeners("error", o, true);
        }
    };

    @Override
    public void load() {
        PlaybackService.setCommandListener(name -> {
            JSObject o = new JSObject();
            o.put("name", name);
            notifyListeners("command", o, true);
        });
        // Conectar un MediaController arranca (y ata) el servicio; Media3 lo pasa a primer plano al sonar
        SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), PlaybackService.class));
        MediaController.Builder builder = new MediaController.Builder(getContext(), token);
        builder.buildAsync().addListener(() -> {
            // El jugador vive en este mismo proceso: lo usamos directo (más simple que ir por la sesión)
            attachWhenReady(0);
        }, androidx.core.content.ContextCompat.getMainExecutor(getContext()));
    }

    private void attachWhenReady(int attempt) {
        ExoPlayer p = PlaybackService.player();
        if (p != null) {
            exo = p;
            if (!listening) {
                exo.addListener(listener);
                listening = true;
            }
            for (Runnable r : new ArrayList<>(pending)) r.run();
            pending.clear();
        } else if (attempt < 50) {
            main.postDelayed(() -> attachWhenReady(attempt + 1), 100);
        }
    }

    /** Ejecuta en el hilo principal cuando el jugador ya existe. */
    private void withPlayer(Runnable r) {
        main.post(() -> {
            if (exo != null) r.run();
            else pending.add(r);
        });
    }

    private MediaItem item(PluginCall call) {
        String url = call.getString("url");
        MediaMetadata.Builder meta = new MediaMetadata.Builder()
                .setTitle(call.getString("title"))
                .setArtist(call.getString("artist"))
                .setAlbumTitle(call.getString("album"));
        String art = call.getString("artwork");
        if (art != null && !art.isEmpty()) meta.setArtworkUri(Uri.parse(art));
        return new MediaItem.Builder().setMediaId(url).setUri(url).setMediaMetadata(meta.build()).build();
    }

    private JSObject snapshot() {
        JSObject o = new JSObject();
        if (exo == null) return o;
        MediaItem cur = exo.getCurrentMediaItem();
        long dur = exo.getDuration();
        o.put("url", cur == null ? "" : cur.mediaId);
        o.put("playing", exo.isPlaying());
        o.put("buffering", exo.getPlaybackState() == Player.STATE_BUFFERING);
        o.put("ended", exo.getPlaybackState() == Player.STATE_ENDED);
        o.put("positionMs", Math.max(0, exo.getCurrentPosition()));
        o.put("durationMs", dur < 0 ? 0 : dur);
        return o;
    }

    private void emitState() {
        notifyListeners("state", snapshot(), true);
    }

    @PluginMethod
    public void setSource(PluginCall call) {
        MediaItem it = item(call);
        boolean autoplay = Boolean.TRUE.equals(call.getBoolean("autoplay", true));
        long start = call.getLong("startMs", 0L);
        withPlayer(() -> {
            exo.setMediaItem(it, start);
            exo.prepare();
            exo.setPlayWhenReady(autoplay);
            call.resolve();
        });
    }

    /** Pista siguiente precargada (null/sin url la quita). */
    @PluginMethod
    public void setNext(PluginCall call) {
        String url = call.getString("url");
        MediaItem it = url == null || url.isEmpty() ? null : item(call);
        withPlayer(() -> {
            if (exo.getMediaItemCount() == 0) {
                call.resolve();
                return;
            }
            int keep = exo.getCurrentMediaItemIndex() + 1;
            if (exo.getMediaItemCount() > keep) {
                if (it != null && keep < exo.getMediaItemCount() && it.mediaId.equals(exo.getMediaItemAt(keep).mediaId)) {
                    call.resolve();
                    return;
                }
                exo.removeMediaItems(keep, exo.getMediaItemCount());
            }
            if (it != null) exo.addMediaItem(it);
            call.resolve();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        withPlayer(() -> {
            if (exo.getPlaybackState() == Player.STATE_IDLE) exo.prepare();
            exo.setPlayWhenReady(true);
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        withPlayer(() -> {
            exo.setPlayWhenReady(false);
            call.resolve();
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        long ms = call.getLong("ms", 0L);
        withPlayer(() -> {
            exo.seekTo(ms);
            call.resolve();
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        float v = call.getFloat("volume", 1f);
        withPlayer(() -> {
            exo.setVolume(Math.max(0f, Math.min(1f, v)));
            call.resolve();
        });
    }

    @PluginMethod
    public void setRate(PluginCall call) {
        float r = call.getFloat("rate", 1f);
        withPlayer(() -> {
            exo.setPlaybackParameters(new PlaybackParameters(Math.max(0.5f, Math.min(2f, r)), 1f)); // el tono no cambia
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        withPlayer(() -> {
            exo.stop();
            exo.clearMediaItems();
            call.resolve();
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        withPlayer(() -> call.resolve(snapshot()));
    }

    @Override
    protected void handleOnDestroy() {
        PlaybackService.setCommandListener(null);
        if (exo != null && listening) exo.removeListener(listener);
        if (controller != null) controller.release();
        main.removeCallbacksAndMessages(null);
        super.handleOnDestroy();
    }
}
