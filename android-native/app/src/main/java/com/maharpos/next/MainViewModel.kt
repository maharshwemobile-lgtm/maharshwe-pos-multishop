package com.maharpos.next

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

data class AppState(
    val authenticated: Boolean = false,
    val loading: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val userName: String = "",
    val dashboard: JSONObject = JSONObject(),
    val products: JSONArray = JSONArray(),
    val categories: JSONArray = JSONArray(),
    val productSuggestions: JSONObject = JSONObject(),
    val repairs: JSONArray = JSONArray(),
    val sales: JSONArray = JSONArray(),
    val customers: JSONArray = JSONArray(),
    val moneyTransactions: JSONArray = JSONArray(),
    val moneySettings: JSONObject = JSONObject(),
    val billerTransactions: JSONArray = JSONArray(),
    val report: JSONObject = JSONObject(),
)

data class SaleLine(val product: JSONObject, val quantity: Int, val unitPrice: Double)
data class SalePayment(val method: String, val amount: Double, val reference: String = "")

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val session = SessionStore(app)
    private val api = ApiClient(session)
    var state = androidx.compose.runtime.mutableStateOf(AppState(authenticated = session.token.isNotBlank(), userName = session.displayName))
        private set

    init { if (session.token.isNotBlank()) refresh() }

    fun login(identity: String, password: String) = viewModelScope.launch {
        busy()
        runCatching { api.login(identity.trim(), password) }.onSuccess { result ->
            val token = result.optString("token", result.optString("accessToken"))
            val user = result.optJSONObject("user")
            if (token.isBlank()) error("Login response did not include a session token")
            session.token = token
            session.displayName = user?.optString("name", user.optString("username", identity)) ?: identity
            state.value = state.value.copy(authenticated = true, loading = false, userName = session.displayName)
            refresh()
        }.onFailure(::fail)
    }

    fun refresh() = viewModelScope.launch {
        busy(clearNotice = false)
        runCatching {
            val dashboard = async { safeGet("/api/business-control/overview") }
            val products = async { safeGet("/api/pos/catalog?limit=100") }
            val categories = async { safeGet("/api/categories") }
            val productSuggestions = async { safeGet("/api/products/suggestions") }
            val repairs = async { safeGet("/api/repair-platform/jobs?limit=100") }
            val sales = async { safeGet("/api/sales?limit=100") }
            val customers = async { safeGet("/api/customers?limit=100") }
            val money = async { safeGet("/api/money-service/transactions?limit=100") }
            val moneySettings = async { safeGet("/api/money-service/settings") }
            val billerTransactions = async { safeGet("/api/biller-transactions?limit=100") }
            val report = async { safeGet("/api/reports/daily-close") }
            state.value.copy(
                authenticated = true, loading = false, error = null, userName = session.displayName,
                dashboard = dashboard.await(), products = arrayOf(products.await(), "items", "products"), categories = arrayOf(categories.await(), "categories", "items"), productSuggestions = productSuggestions.await(),
                repairs = arrayOf(repairs.await(), "jobs", "repairs"), sales = arrayOf(sales.await(), "sales", "items"),
                customers = arrayOf(customers.await(), "customers", "items"),
                moneyTransactions = arrayOf(money.await(), "transactions", "items"), moneySettings = moneySettings.await(),
                billerTransactions = arrayOf(billerTransactions.await(), "transactions", "items"), report = report.await(),
            )
        }.onSuccess { state.value = it }.onFailure { if (it is ApiException && it.status == 401) logout() else fail(it) }
    }

    fun createProduct(name: String, brand: String, model: String, categoryId: String?, sku: String, cost: Double, price: Double, stock: Int, done: (Boolean) -> Unit) = launchWrite(done) {
        val variant = JSONObject().put("variantName", "Default").put("sku", sku.ifBlank { null }).put("unit", "pcs")
            .put("costPrice", cost).put("standardSellingPrice", price).put("minimumSellingPrice", cost)
            .put("initialQuantity", stock).put("minAlertQuantity", 2).put("active", true)
        api.post("/api/products", JSONObject().put("name", name).put("brand", brand.ifBlank { null }).put("model", model.ifBlank { null }).put("categoryId", categoryId)
            .put("productType", "NORMAL_PRODUCT").put("active", true).put("variants", JSONArray().put(variant)))
        "Product saved"
    }

    fun createCategory(name: String, done: (Boolean) -> Unit) = launchWrite(done) {
        api.post("/api/categories", JSONObject().put("name", name).put("active", true))
        "Category created"
    }

    fun updateProduct(item: JSONObject, name: String, brand: String, model: String, categoryId: String?, price: Double, done: (Boolean) -> Unit) = launchWrite(done) {
        val productId = item.optString("productId", item.optString("id"))
        api.patch("/api/products/$productId", JSONObject().put("name", name).put("brand", brand.ifBlank { null }).put("model", model.ifBlank { null }).put("categoryId", categoryId))
        val variantId = item.optString("id")
        if (variantId.isNotBlank() && variantId != productId) api.patch("/api/variants/$variantId", JSONObject().put("standardSellingPrice", price))
        "Product updated"
    }

    fun createRepair(customer: String, phone: String, brand: String, model: String, problem: String, estimate: Double, deposit: Double, done: (Boolean) -> Unit) = launchWrite(done) {
        api.post("/api/repair-platform/intake", JSONObject().put("customerName", customer).put("customerPhone", phone.ifBlank { null })
            .put("deviceBrand", brand.ifBlank { null }).put("deviceModel", model).put("problem", problem)
            .put("estimatedCost", estimate).put("deposit", deposit).put("priority", "NORMAL").put("accessories", JSONArray()))
        "Repair job created"
    }

    fun completeSale(cart: List<SaleLine>, customer: JSONObject?, customerName: String, customerPhone: String, payment: String, payments: List<SalePayment>, done: (Boolean) -> Unit) = launchWrite(done) {
        val items = JSONArray()
        cart.forEach { line -> items.put(JSONObject().put("productVariantId", line.product.optString("id")).put("quantity", line.quantity).put("unitPrice", line.unitPrice)) }
        val payload = JSONObject().put("items", items).put("discount", 0).put("paymentMethod", if (payments.size > 1) "MIXED" else payment)
        if (payments.isNotEmpty()) payload.put("payments", JSONArray().apply { payments.forEach { put(JSONObject().put("method", it.method).put("amount", it.amount).put("reference", it.reference.ifBlank { null })) } })
        val selectedName = customer?.optString("name").orEmpty().ifBlank { customerName }
        val selectedPhone = customer?.optString("phone").orEmpty().ifBlank { customerPhone }
        if (selectedName.isNotBlank()) payload.put("customerName", selectedName)
        if (selectedPhone.isNotBlank()) payload.put("customerPhone", selectedPhone)
        api.post("/api/sales", payload)
        "Sale completed successfully"
    }

    fun completeSale(cart: List<JSONObject>, customer: JSONObject?, customerName: String, customerPhone: String, payment: String, done: (Boolean) -> Unit) =
        completeSale(cart.groupBy { it.optString("id") }.values.map { SaleLine(it.first(), it.size, productPrice(it.first())) }, customer, customerName, customerPhone, payment, emptyList(), done)

    fun updateRepairStatus(id: String, status: String, done: (Boolean) -> Unit) = launchWrite(done) {
        api.patch("/api/repair-platform/jobs/$id/status", JSONObject().put("status", status).put("note", "Updated from Mahar POS Android"))
        "Repair status updated"
    }

    fun createBusinessRecord(type: String, title: String, amount: Double, method: String, accountId: String?, note: String, done: (Boolean) -> Unit) = launchWrite(done) {
        val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).apply {
            timeZone = java.util.TimeZone.getTimeZone("Asia/Yangon")
        }.format(java.util.Date())
        val path = if (type == "income") "/api/business-control/other-income" else "/api/business-control/expenses"
        val body = JSONObject().put(if (type == "income") "incomeDate" else "expenseDate", today)
            .put(if (type == "income") "source" else "category", title).put("amount", amount).put("method", method)
            .put("moneyAccountId", accountId).put("note", note.ifBlank { null })
        if (type == "income") body.put("category", "OTHER_INCOME")
        api.post(path, body)
        if (type == "income") "Other income saved" else "Expense saved"
    }

    fun createMoney(mode: String, methodId: String, cashId: String, amount: Double, name: String, phone: String, fee: Double, timing: String, paid: Double, done: (Boolean) -> Unit) = launchWrite(done) {
        val body = JSONObject().put("mode", mode).put("paymentMethodId", methodId).put("cashAccountId", cashId)
            .put("amount", amount).put("feeMode", "CUSTOM").put("feeAmount", fee).put("paymentTiming", timing)
        if (timing == "PARTIAL") body.put("paidAmount", paid)
        if (mode == "TRANSFER") body.put("receiverName", name).put("receiverPhone", phone)
        else body.put("withdrawerName", name.ifBlank { null }).put("withdrawerPhone", phone.ifBlank { null })
        api.post("/api/money-service/transactions", body)
        "Money service transaction saved"
    }

    fun createBiller(name: String, type: String, opening: Double, done: (Boolean) -> Unit) = launchWrite(done) {
        api.post("/api/billers", JSONObject().put("name", name).put("type", type).put("openingBalance", opening).put("isActive", true))
        "Biller created"
    }

    fun createBillerTransaction(kind: String, billerId: String, amount: Double, accountId: String?, note: String, timing: String, paid: Double, done: (Boolean) -> Unit) = launchWrite(done) {
        val body = JSONObject().put("billerId", billerId).put("amount", amount).put("paymentTiming", timing)
            .put("paymentMethod", "CASH").put("note", note.ifBlank { null })
        if (timing == "PARTIAL") body.put("paidAmount", paid)
        if (!accountId.isNullOrBlank()) body.put("paymentAccountId", accountId)
        api.post("/api/biller-transactions/${kind.lowercase()}", body)
        "Biller ${kind.lowercase()} saved"
    }

    fun collectMoney(id:String, accountId:String, amount:Double, done:(Boolean)->Unit)=launchWrite(done){
        api.post("/api/money-service/transactions/$id/collect",JSONObject().put("accountId",accountId).put("amount",amount).put("note","Android collection"))
        "Payment collected"
    }

    private fun launchWrite(done: (Boolean) -> Unit, work: suspend () -> String) = viewModelScope.launch {
        busy()
        runCatching { work() }.onSuccess { message -> state.value = state.value.copy(loading = false, notice = message); done(true); refresh() }
            .onFailure { fail(it); done(false) }
    }

    private fun busy(clearNotice: Boolean = true) { state.value = state.value.copy(loading = true, error = null, notice = if (clearNotice) null else state.value.notice) }
    private fun fail(error: Throwable) { state.value = state.value.copy(loading = false, error = error.message ?: "Request failed") }
    private suspend fun safeGet(path: String) = runCatching { api.get(path) }.getOrElse { JSONObject() }
    private fun arrayOf(json: JSONObject, vararg keys: String): JSONArray { for (key in keys) json.optJSONArray(key)?.let { return it }; return JSONArray() }
    private fun productPrice(product: JSONObject) = product.optDouble("standardSellingPrice", product.optDouble("sellingPrice", product.optDouble("price", 0.0)))
    fun logout() { session.clear(); state.value = AppState() }
}
