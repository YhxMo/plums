package dev.plums.tlsprobe;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.view.WindowInsets;
import android.widget.ScrollView;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import org.json.JSONObject;
import android.os.Looper;
import android.widget.TextView;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** Synthetic bytes only; no vault, bridge, WebView, or request credential. */
public final class ProbeActivity extends Activity {
    static { System.loadLibrary("plums_tls_jni_probe"); }
    private byte[] temporary;
    private native String runProbe(int port, byte[] ca);

    public byte[] readFake(int mode) {
        if (Looper.myLooper() == Looper.getMainLooper()) throw new IllegalStateException();
        if (mode == 1) return null;
        if (mode == 2) throw new IllegalStateException();
        temporary = new byte[] {115,121,110,116,104,101,116,105,99,45,111,110,108,121};
        return temporary;
    }

    public boolean javaCleared() {
        if (temporary == null) return false;
        for (byte value : temporary) if (value != 0) return false;
        return true;
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView status = new TextView(this);
        status.setText("Running isolated TLS/JNI probe");
        ScrollView content = new ScrollView(this);
        content.addView(status);
        content.setPadding(16, 32, 16, 16);
        if (Build.VERSION.SDK_INT >= 30) content.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
            view.setPadding(bars.left + 16, bars.top + 16, bars.right + 16, bars.bottom + 16);
            return insets;
        });
        setContentView(content);
        int port = getIntent().getIntExtra("port", 0);
        if (port < 1 || port > 65535) throw new IllegalArgumentException();
        new Thread(() -> {
            String result;
            try {
                try (InputStream input = getResources().openRawResource(getResources().getIdentifier("probe_ca", "raw", getPackageName()));
                     ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    byte[] chunk = new byte[1024];
                    int count;
                    while ((count = input.read(chunk)) != -1) {
                        bytes.write(chunk, 0, count);
                        if (bytes.size() > 8192) throw new IllegalArgumentException();
                    }
                    result = runProbe(port, bytes.toByteArray());
                }
            }
            catch (Throwable error) { result = "{\"failed\":true}"; }
            try {
                Files.write(new File(getFilesDir(), "result.json").toPath(),
                    result.getBytes(StandardCharsets.UTF_8));
            } catch (Exception error) { throw new IllegalStateException(); }
            String pretty;
            try { pretty = new JSONObject(result).toString(2); }
            catch (Exception error) { pretty = "Probe failed"; }
            final String report = pretty;
            runOnUiThread(() -> status.setText(report));
        }, "probe-entry").start();
    }
}
