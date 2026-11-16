package game.granit;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Process;

/**
 * Полный перезапуск игры. Работает в отдельном процессе: завершает основной процесс
 * (вместе с ним сбрасывается блокировка WebGL после сбоя видеочипа) и запускает игру заново.
 */
public class RestartActivity extends Activity {
    static final String EXTRA_PID = "pid";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        int pid = getIntent().getIntExtra(EXTRA_PID, -1);
        if (pid > 0 && pid != Process.myPid()) Process.killProcess(pid);
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(i);
        finish();
        Runtime.getRuntime().exit(0);
    }
}
