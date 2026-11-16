package game.granit;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Оболочка игры «Объект „Гранит“»: полноэкранный WebView, который отдаёт веб-сборку
 * игры из assets/www через локальный виртуальный хост. Сторонних библиотек нет.
 */
public class MainActivity extends Activity {
    private static final String TAG = "Granit";
    private static final String HOST = "granit.game";
    private static final String START_URL = "https://" + HOST + "/index.html";

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }

        web = new WebView(this);
        web.setBackgroundColor(0xFF000000);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        web.loadUrl(START_URL);
        hideSystemUi();
    }

    /** Системная кнопка «Назад»: сначала закрываем панели игры, затем сворачиваем приложение. */
    private void handleBack() {
        if (web == null) return;
        web.evaluateJavascript("(window.__granitBack ? window.__granitBack() : false)", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onPause() {
        // игра сама делает автосохранение и глушит звук
        if (web != null) {
            web.evaluateJavascript("window.__granitPause && window.__granitPause()", null);
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.__granitResume && window.__granitResume()", null);
        }
        hideSystemUi();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController c = window.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.equals("application/json") || mime.equals("image/svg+xml");
    }

    private static WebResourceResponse status(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason,
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    /** Раздаёт файлы игры из assets/www и блокирует любые обращения во внешнюю сеть. */
    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if (!"https".equals(scheme) && !"http".equals(scheme)) return null;
            if (!HOST.equals(uri.getHost())) return status(403, "Blocked");
            String path = uri.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
            if (path.contains("..")) return status(403, "Blocked");
            try {
                InputStream in = getAssets().open("www" + path);
                String mime = mimeOf(path);
                WebResourceResponse r = new WebResourceResponse(mime, isText(mime) ? "utf-8" : null, in);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                r.setResponseHeaders(headers);
                return r;
            } catch (IOException e) {
                Log.w(TAG, "Нет ресурса: " + path);
                return status(404, "Not Found");
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !HOST.equals(request.getUrl().getHost());
        }

        /** Процесс отрисовки WebView упал (нехватка памяти): пересоздаём экран, а не роняем приложение. */
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            Log.w(TAG, "Процесс отрисовки завершён, перезапуск");
            if (view == web) {
                web.destroy();
                web = null;
                recreate();
            }
            return true;
        }
    }

    /** Мост для страницы игры. */
    private class Bridge {
        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(MainActivity.this::finish);
        }

        /** Полный перезапуск процесса: снимает блокировку WebGL после сбоя видеочипа. */
        @JavascriptInterface
        public void restartApp() {
            runOnUiThread(() -> {
                Intent i = new Intent(MainActivity.this, RestartActivity.class);
                i.putExtra(RestartActivity.EXTRA_PID, android.os.Process.myPid());
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                finishAffinity();
            });
        }
    }
}
