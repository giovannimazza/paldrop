package com.giovannimazza.paldrop;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaSavePlugin.class);
        registerPlugin(LocalServerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
