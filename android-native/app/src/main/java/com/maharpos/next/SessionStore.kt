package com.maharpos.next

import android.content.Context

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("mahar_pos_secure_session", Context.MODE_PRIVATE)
    var token: String
        get() = prefs.getString("token", "").orEmpty()
        set(value) { prefs.edit().putString("token", value).apply() }
    var displayName: String
        get() = prefs.getString("display_name", "Mahar POS User").orEmpty()
        set(value) { prefs.edit().putString("display_name", value).apply() }
    fun clear() = prefs.edit().clear().apply()
}
