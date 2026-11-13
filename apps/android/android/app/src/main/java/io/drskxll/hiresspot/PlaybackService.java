package io.drskxll.hiresspot;

import android.content.Intent;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/**
 * Servicio de reproducción en primer plano. Posee el ExoPlayer y la MediaSession: Media3 muestra la
 * notificación con controles y mantiene vivo el proceso mientras suena, también con la pantalla apagada.
 *
 * La cola vive en el motor de la app (JS): "siguiente" y "anterior" de la notificación o de los auriculares
 * no se resuelven aquí, se reenvían al motor como comandos.
 */
public class PlaybackService extends MediaSessionService {
    /** Quien quiera enterarse de comandos remotos (el plugin). */
    public interface CommandListener {
        void onCommand(String name);
    }

    private static volatile PlaybackService instance;
    private static volatile CommandListener commandListener;

    private ExoPlayer exo;
    private MediaSession session;

    public static @Nullable ExoPlayer player() {
        PlaybackService s = instance;
        return s == null ? null : s.exo;
    }

    public static void setCommandListener(@Nullable CommandListener l) {
        commandListener = l;
    }

    private static void dispatch(String name) {
        CommandListener l = commandListener;
        if (l != null) l.onCommand(name);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        exo = new ExoPlayer.Builder(this)
                .setAudioAttributes(
                        new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                        /* handleAudioFocus= */ true)
                .setHandleAudioBecomingNoisy(true) // pausa al desconectar los auriculares
                .setWakeMode(C.WAKE_MODE_NETWORK) // mantiene CPU y wifi con la pantalla apagada
                .build();

        Player forwarding = new ForwardingPlayer(exo) {
            @Override
            public Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon()
                        .add(COMMAND_SEEK_TO_NEXT)
                        .add(COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                        .add(COMMAND_SEEK_TO_PREVIOUS)
                        .add(COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                        .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                return command == COMMAND_SEEK_TO_NEXT || command == COMMAND_SEEK_TO_NEXT_MEDIA_ITEM
                        || command == COMMAND_SEEK_TO_PREVIOUS || command == COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM
                        || super.isCommandAvailable(command);
            }

            @Override public boolean hasNextMediaItem() { return true; }
            @Override public boolean hasPreviousMediaItem() { return true; }
            @Override public void seekToNext() { dispatch("next"); }
            @Override public void seekToNextMediaItem() { dispatch("next"); }
            @Override public void seekToPrevious() { dispatch("prev"); }
            @Override public void seekToPreviousMediaItem() { dispatch("prev"); }
        };

        // Ícono propio (barras de HiResSpot) en la barra de estado en vez del genérico de Media3
        DefaultMediaNotificationProvider provider = new DefaultMediaNotificationProvider.Builder(this).build();
        provider.setSmallIcon(R.drawable.ic_stat_hiresspot);
        setMediaNotificationProvider(provider);

        session = new MediaSession.Builder(this, forwarding).setId("hiresspot").build();
        instance = this;
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // Si la app se cierra de "recientes" y no está sonando, el servicio no tiene razón de seguir
        Player p = session == null ? null : session.getPlayer();
        if (p == null || !p.getPlayWhenReady() || p.getMediaItemCount() == 0) stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (session != null) {
            session.release();
            session = null;
        }
        if (exo != null) {
            exo.release();
            exo = null;
        }
        super.onDestroy();
    }
}
