package com.maharpos.next

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.media.AudioManager
import android.media.ToneGenerator
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Image
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.automirrored.outlined.TrendingDown
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import androidx.lifecycle.viewmodel.compose.viewModel
import org.json.JSONArray
import org.json.JSONObject

private val Green = Color(0xFF079455)
private val DarkGreen = Color(0xFF063D2B)
private val Orange = Color(0xFFFF9800)
private val Canvas = Color(0xFFF5F8F6)

class MainActivity : ComponentActivity() {
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaharTheme {
                MaharApp {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
            }
        }
    }
}

@Composable
private fun MaharTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(primary = Green, secondary = Orange, background = Canvas, surface = Color.White),
        typography = Typography(bodyLarge = MaterialTheme.typography.bodyLarge.copy(lineHeight = 24.sp)),
        content = content
    )
}

@Composable
private fun MaharApp(vm: MainViewModel = viewModel(), requestNotificationPermission: () -> Unit) {
    val state by vm.state
    LaunchedEffect(state.authenticated) {
        if (state.authenticated) requestNotificationPermission()
    }
    if (!state.authenticated) LoginScreen(state.loading, state.error, vm::login)
    else MainShell(state, vm)
}

@Composable
private fun LoginScreen(loading: Boolean, error: String?, onLogin: (String, String) -> Unit) {
    val context=LocalContext.current;val saved=context.getSharedPreferences("mahar_pos_login",android.content.Context.MODE_PRIVATE)
    var identity by remember { mutableStateOf(saved.getString("username","").orEmpty()) }
    var password by remember { mutableStateOf(saved.getString("password","").orEmpty()) };var rememberLogin by remember{mutableStateOf(saved.getBoolean("remember",false))}
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.White,Color(0xFFFFF7ED),Color(0xFFE8F7EF)))).padding(22.dp), contentAlignment = Alignment.Center) {
        Card(Modifier.fillMaxWidth().widthIn(max = 520.dp), shape = RoundedCornerShape(28.dp),colors=CardDefaults.cardColors(containerColor=Color.White),border=androidx.compose.foundation.BorderStroke(1.dp,Color(0xFFFFD7A3)), elevation = CardDefaults.cardElevation(12.dp)) {
            Column(Modifier.padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Surface(color=Color.White,shape=RoundedCornerShape(18.dp),modifier=Modifier.fillMaxWidth()){Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center){Image(
                    painter = painterResource(R.drawable.mahar_pos_brand_logo),
                    contentDescription = "Mahar POS",
                    modifier = Modifier.fillMaxWidth(.68f).height(126.dp).padding(7.dp),
                    contentScale = ContentScale.Fit,
                )}}
                Spacer(Modifier.height(8.dp))
                Text("Shop Management System", color = DarkGreen,fontWeight=FontWeight.Bold,fontSize=16.sp)
                Spacer(Modifier.height(28.dp))
                OutlinedTextField(identity, { identity = it }, Modifier.fillMaxWidth(), label = { Text("Email or username") }, leadingIcon = { Icon(Icons.Outlined.Person, null) }, singleLine = true, shape = RoundedCornerShape(16.dp))
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Password") }, leadingIcon = { Icon(Icons.Outlined.Lock, null) }, visualTransformation = PasswordVisualTransformation(), singleLine = true, shape = RoundedCornerShape(16.dp))
                if (!error.isNullOrBlank()) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.fillMaxWidth().padding(top = 10.dp))
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Checkbox(rememberLogin,{rememberLogin=it});Text("Save username and password",fontSize=13.sp)}
                Button(onClick = { saved.edit().apply{putBoolean("remember",rememberLogin);if(rememberLogin){putString("username",identity);putString("password",password)}else{remove("username");remove("password")}}.apply();onLogin(identity, password) }, enabled = identity.isNotBlank() && password.isNotBlank() && !loading, modifier = Modifier.fillMaxWidth().padding(top = 10.dp).height(54.dp), shape = RoundedCornerShape(16.dp),colors=ButtonDefaults.buttonColors(containerColor=DarkGreen)) {
                    if (loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = Color.White) else Text("Sign in securely", fontWeight = FontWeight.Bold)
                }
                TextButton({context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://maharshwe.shop/")))}){Text("No account? Register on website")}
                Text("Your shop data stays isolated and protected.", color = Color.Gray, fontSize = 12.sp, modifier = Modifier.padding(top = 16.dp))
            }
        }
    }
}

private enum class Page(val label: String, val icon: ImageVector) {
    HOME("Home", Icons.Outlined.SpaceDashboard), SALE("Sale", Icons.Outlined.ShoppingCart), PRODUCTS("Products", Icons.Outlined.Inventory2), REPAIRS("Repairs", Icons.Outlined.Build), MORE("More", Icons.Outlined.GridView),
    HISTORY("Sales history", Icons.AutoMirrored.Outlined.ReceiptLong), MONEY("Money service", Icons.Outlined.AccountBalanceWallet), BILL("Bill / Eload", Icons.Outlined.Receipt), REPORTS("Reports", Icons.Outlined.BarChart),
    INCOME("Other income", Icons.AutoMirrored.Outlined.TrendingUp), EXPENSE("Expense", Icons.AutoMirrored.Outlined.TrendingDown), SETTINGS("Settings", Icons.Outlined.Settings), ABOUT("About us", Icons.Outlined.Info)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainShell(state: AppState, vm: MainViewModel) {
    var page by remember { mutableStateOf(Page.HOME) }
    Scaffold(
        topBar = {
            TopAppBar(title = { Column { Text(page.label, fontWeight = FontWeight.ExtraBold); Text(state.userName, fontSize = 12.sp, color = Color.Gray) } }, actions = {
                IconButton(vm::refresh) { Icon(Icons.Outlined.Sync, "Refresh") }
                IconButton(vm::logout) { Icon(Icons.AutoMirrored.Outlined.Logout, "Logout") }
            })
        },
        bottomBar = {
            NavigationBar(containerColor = Color.White) {
                Page.entries.take(5).forEach { item -> NavigationBarItem(selected = page == item || (item == Page.MORE && page.ordinal > Page.MORE.ordinal), onClick = { page = item }, icon = { Icon(item.icon, null) }, label = { Text(item.label, fontSize = 11.sp) }) }
            }
        },
        containerColor = Canvas
    ) { inset ->
        Box(Modifier.padding(inset).fillMaxSize()) {
            when (page) {
                Page.HOME -> DashboardScreen(state) { page = it }
                Page.SALE -> SaleScreen(state, vm)
                Page.PRODUCTS -> ProductsScreen(state, vm)
                Page.REPAIRS -> EnhancedRepairsScreen(state, vm)
                Page.MORE -> EnhancedMoreScreen(state.sales) { page = it }
                Page.HISTORY -> SalesHistoryScreen(state, vm)
                Page.MONEY -> MoneyServiceScreen(state, vm, 0)
                Page.BILL -> MoneyServiceScreen(state, vm, 2)
                Page.REPORTS -> ReportScreen(state, vm)
                Page.INCOME -> BusinessRecordScreen("income", state, vm)
                Page.EXPENSE -> BusinessRecordScreen("expense", state, vm)
                Page.SETTINGS -> SettingsScreen()
                Page.ABOUT -> AboutScreen()
            }
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
        }
    }
}

@Composable
private fun DashboardScreen(state: AppState, open: (Page) -> Unit) {
    val pendingRepairs = jsonObjects(state.repairs).count { it.optString("status") !in setOf("COMPLETED", "DELIVERED", "CANNOT_REPAIR") }
    val directProfit = findNumber(state.dashboard, "todayProfit", "totalProfit", "netProfit")
    val calculatedProfit = findNumber(state.dashboard, "productProfit") + findNumber(state.dashboard, "repairProfit") + findNumber(state.dashboard, "moneyServiceProfit")
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 18.dp), contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Surface(Modifier.fillMaxWidth().padding(top = 10.dp), color = DarkGreen, shape = RoundedCornerShape(26.dp)) {
                Column(Modifier.padding(22.dp)) {
                    Text("Business overview", color = Color.White, fontSize = 25.sp, fontWeight = FontWeight.ExtraBold)
                    Text("Live PostgreSQL shop data", color = Color(0xFFBDE9D3))
                    Spacer(Modifier.height(20.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Metric("Today sales", findNumber(state.dashboard,"todayOrders","todaySales","saleCount").toInt().toString(), Icons.AutoMirrored.Outlined.ReceiptLong, Modifier.weight(1f))
                        Metric("Pending repairs", pendingRepairs.toString(), Icons.Outlined.Build, Modifier.weight(1f))
                    }
                }
            }
        }
        item { SectionTitle("Today") }
        item { Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { StatCard("Sales", money(findNumber(state.dashboard, "todaySaleIncome", "sales", "totalSales", "salesAmount")), Green, Modifier.weight(1f)); StatCard("Income", money(findNumber(state.dashboard, "todayTotalIncome", "income", "totalIncome")), Orange, Modifier.weight(1f)) } }
        item { Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { StatCard("Profit", money(if (directProfit != 0.0) directProfit else calculatedProfit), Color(0xFF2563EB), Modifier.weight(1f)); StatCard("Expenses", money(findNumber(state.dashboard, "todayExpense", "expenseTotal", "totalExpense")), Color(0xFFDC2626), Modifier.weight(1f)) } }
        if (!state.error.isNullOrBlank()) item { ErrorCard(state.error) }
        item { SectionTitle("Quick actions") }
        item { QuickActions(open) }
    }
}

@Composable private fun Metric(label: String, value: String, icon: ImageVector, modifier: Modifier) = Surface(modifier, color = Color.White.copy(alpha = .1f), shape = RoundedCornerShape(18.dp)) { Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Icon(icon, null, tint = Color.White); Spacer(Modifier.width(10.dp)); Column { Text(value, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 22.sp); Text(label, color = Color(0xFFBDE9D3), fontSize = 12.sp) } } }
@Composable private fun StatCard(label: String, value: String, color: Color, modifier: Modifier) = Card(modifier, shape = RoundedCornerShape(20.dp)) { Column(Modifier.padding(17.dp)) { Box(Modifier.size(10.dp).background(color, RoundedCornerShape(9.dp))); Spacer(Modifier.height(12.dp)); Text(label, color = Color.Gray); Text(value, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis) } }
@Composable private fun SectionTitle(text: String) = Text(text, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = DarkGreen, modifier = Modifier.padding(top = 8.dp))

@Composable private fun QuickActions(open: (Page) -> Unit) {
    val actions = listOf(
        Triple(Icons.Outlined.AccountBalanceWallet, "Money Service", Page.MONEY),
        Triple(Icons.Outlined.Receipt, "Bill / Eload", Page.BILL),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        actions.forEach { (icon, label, page) ->
            Card(Modifier.weight(1f).clickable { open(page) }, shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.padding(vertical = 18.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(icon, null, tint = Green)
                    Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
                }
            }
        }
    }
}

@Composable
private fun ProductsScreen(state: AppState, vm: MainViewModel) {
    var query by remember { mutableStateOf("") }; var add by remember { mutableStateOf(false) }; var edit by remember { mutableStateOf<JSONObject?>(null) }; var category by remember { mutableStateOf<JSONObject?>(null) }
    val data = remember(state.products, query, category) { jsonObjects(state.products).filter { (category == null || it.optString("categoryId") == category?.optString("id")) && (query.isBlank() || productName(it).contains(query, true) || it.optString("sku").contains(query, true)) } }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)){BarcodeField("Search product / Scan barcode",query){query=it}}
            Spacer(Modifier.width(10.dp)); FilledIconButton({ add = true }) { Icon(Icons.Outlined.Add, "Add product") }
        }
        JsonChoice("Category", category, jsonObjects(state.categories), { it.optString("name") }) { category = it }
        Text("${data.size} products", color = Color.Gray, modifier = Modifier.padding(vertical = 12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(9.dp)) { items(data.take(100)) { ProductRow(it) { edit = it } } }
    }
    if (add) ProductDialog(state.productSuggestions,state.products,state.categories, { add = false },{categoryName->vm.createCategory(categoryName){}}) { name, brand, model, categoryId, sku, cost, price, stock -> vm.createProduct(name, brand, model, categoryId, sku, cost, price, stock) { if (it) add = false } }
    edit?.let { item -> ProductDetailDialog(item,state.productSuggestions,state.products,state.categories,{edit=null},{name,brand,model,categoryId,barcode,price->vm.updateProduct(item,name,brand,model,categoryId,barcode,price){if(it)edit=null}},{quantity,note->vm.adjustStock(item,quantity,note){if(it)edit=null}}) }
}

@Composable private fun ProductDialog(suggestions:JSONObject,products:JSONArray,categories:JSONArray,close:()->Unit,addCategory:(String)->Unit, save:(String,String,String,String?,String,Double,Double,Int)->Unit){
    var name by remember{mutableStateOf("")};var brand by remember{mutableStateOf("")};var model by remember{mutableStateOf("")};var category by remember{mutableStateOf<JSONObject?>(null)};var newCategory by remember{mutableStateOf("")};var showNewCategory by remember{mutableStateOf(false)};var sku by remember{mutableStateOf("")};var cost by remember{mutableStateOf("")};var price by remember{mutableStateOf("")};var stock by remember{mutableStateOf("")}
    val productRows=jsonObjects(products);val brands=(jsonStrings(suggestions.optJSONArray("brands")?:JSONArray())+productRows.map{it.optString("brand")}).filter{it.isNotBlank()}.distinct();val pairs=jsonObjects(suggestions.optJSONArray("pairs")?:JSONArray())+productRows.map{JSONObject().put("brand",it.optString("brand")).put("model",it.optString("model"))};val allModels=(jsonStrings(suggestions.optJSONArray("models")?:JSONArray())+productRows.map{it.optString("model")}).filter{it.isNotBlank()}.distinct();val models=remember(brand,suggestions,products){val matched=pairs.filter{it.optString("brand").equals(brand,true)}.map{it.optString("model")};(matched+allModels).filter{it.isNotBlank()}.distinct()}
    AlertDialog(onDismissRequest=close,title={Text("Add product")},text={LazyColumn(verticalArrangement=Arrangement.spacedBy(8.dp)){item{Field("Product name",name){name=it}};item{AutocompleteField("Brand",brand,brands){brand=it}};item{AutocompleteField("Model",model,models){model=it}};item{JsonChoice("Category",category,jsonObjects(categories),{it.optString("name")}){category=it}};item{TextButton({showNewCategory=!showNewCategory}){Text(if(showNewCategory)"Cancel new category" else "+ Add new category")}};if(showNewCategory){item{Row(verticalAlignment=Alignment.CenterVertically){Box(Modifier.weight(1f)){Field("New category",newCategory){newCategory=it}};Spacer(Modifier.width(6.dp));Button({addCategory(newCategory);newCategory="";showNewCategory=false},enabled=newCategory.isNotBlank()){Text("Add")}}}};item{BarcodeField("SKU / Barcode",sku,{sku=it})};item{NumberField("Cost price",cost){cost=it}};item{NumberField("Selling price",price){price=it}};item{NumberField("Opening stock",stock){stock=it}}}},dismissButton={TextButton(close){Text("Cancel")}},confirmButton={Button({save(name,brand,model,category?.optString("id"),sku,cost.toDoubleOrNull()?:0.0,price.toDoubleOrNull()?:0.0,stock.toIntOrNull()?:0)},enabled=name.isNotBlank()&&(price.toDoubleOrNull()?:0.0)>0){Text("Save product")}})
}

@Composable private fun ProductDetailDialog(item:JSONObject,suggestions:JSONObject,products:JSONArray,categories:JSONArray,close:()->Unit,save:(String,String,String,String?,String,Double)->Unit,adjust:(Int,String)->Unit){var mode by remember{mutableStateOf("DETAIL")};var name by remember{mutableStateOf(productName(item).substringBefore(" · "))};var brand by remember{mutableStateOf(item.optString("brand",item.optJSONObject("product")?.optString("brand").orEmpty()))};var model by remember{mutableStateOf(item.optString("model",item.optJSONObject("product")?.optString("model").orEmpty()))};var category by remember{mutableStateOf(jsonObjects(categories).firstOrNull{it.optString("id")==item.optString("categoryId")})};var selling by remember{mutableStateOf(price(item).toString())};var barcode by remember{mutableStateOf(item.optString("barcode"))};var quantity by remember{mutableStateOf(stock(item).toString())};var note by remember{mutableStateOf("")};val rows=jsonObjects(products);val brands=(jsonStrings(suggestions.optJSONArray("brands")?:JSONArray())+rows.map{it.optString("brand")}).filter{it.isNotBlank()}.distinct();val models=(jsonStrings(suggestions.optJSONArray("models")?:JSONArray())+rows.map{it.optString("model")}).filter{it.isNotBlank()}.distinct();val backAction:()->Unit=if(mode=="DETAIL")close else {{mode="DETAIL"}};AlertDialog(onDismissRequest=close,title={Text(when(mode){"EDIT"->"Edit product";"STOCK"->"Adjust stock";else->"Product detail"})},text={LazyColumn(verticalArrangement=Arrangement.spacedBy(9.dp)){if(mode=="DETAIL"){item{ProductRow(item)};item{Text("Barcode: ${barcode.ifBlank{"—"}}\nBrand: ${brand.ifBlank{"—"}}\nModel: ${model.ifBlank{"—"}}\nCurrent stock: ${stock(item)}",lineHeight=22.sp)};item{Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){OutlinedButton({mode="EDIT"},Modifier.weight(1f)){Icon(Icons.Outlined.Edit,null);Text(" Edit")};OutlinedButton({mode="STOCK"},Modifier.weight(1f)){Icon(Icons.Outlined.Inventory,null);Text(" Stock")}}}}else if(mode=="EDIT"){item{Field("Product name",name){name=it}};item{AutocompleteField("Brand",brand,brands){brand=it}};item{AutocompleteField("Model",model,models){model=it}};item{JsonChoice("Category",category,jsonObjects(categories),{it.optString("name")}){category=it}};item{BarcodeField("Barcode / Scan",barcode){barcode=it}};item{NumberField("Selling price",selling){selling=it}}}else{item{Text("Current stock ${stock(item)}",fontWeight=FontWeight.Bold)};item{NumberField("New stock quantity",quantity){quantity=it}};item{Field("Reason",note){note=it}}}}},dismissButton={TextButton(onClick=backAction){Text(if(mode=="DETAIL")"Close" else "Back")}},confirmButton={if(mode=="DETAIL"){}else Button({if(mode=="EDIT")save(name,brand,model,category?.optString("id"),barcode,selling.toDoubleOrNull()?:0.0)else adjust(quantity.toIntOrNull()?:stock(item),note)},enabled=if(mode=="EDIT")name.isNotBlank() else note.isNotBlank()){Text(if(mode=="EDIT")"Save" else "Adjust")}})}

@Composable private fun SaleScreen(state:AppState,vm:MainViewModel){
    var query by remember{mutableStateOf("")};var category by remember{mutableStateOf<JSONObject?>(null)};val cart=remember{mutableStateListOf<SaleLine>()};var editCart by remember{mutableStateOf(false)};var checkout by remember{mutableStateOf(false)};var added by remember{mutableStateOf("")};val scope=rememberCoroutineScope()
    val products=remember(state.products,query,category){jsonObjects(state.products).filter{(category==null||it.optString("categoryId")==category?.optString("id"))&&(query.isBlank()||productName(it).contains(query,true)||it.optString("sku").contains(query,true))}};val total=cart.sumOf{it.quantity*it.unitPrice}
    fun add(p:JSONObject){if(stock(p)<=0)return;val i=cart.indexOfFirst{it.product.optString("id")==p.optString("id")};if(i<0)cart.add(SaleLine(p,1,price(p)))else if(cart[i].quantity<stock(p))cart[i]=cart[i].copy(quantity=cart[i].quantity+1);playTone();added=productName(p);scope.launch{delay(700);added=""}}
    Column(Modifier.fillMaxSize().padding(16.dp)){Surface(color=DarkGreen,shape=RoundedCornerShape(22.dp),modifier=Modifier.fillMaxWidth().clickable(enabled=cart.isNotEmpty()){editCart=true}){Row(Modifier.padding(17.dp),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text("Current cart",color=Color.White,fontWeight=FontWeight.Bold);Text("${cart.sumOf{it.quantity}} items · Tap to edit",color=Color(0xFFBDE9D3))};Text(money(total),color=Color.White,fontSize=20.sp,fontWeight=FontWeight.ExtraBold);Icon(Icons.Outlined.Edit,null,tint=Color.White)}};Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.CenterEnd){androidx.compose.animation.AnimatedVisibility(visible=added.isNotBlank(),enter=slideInVertically{it/2}+fadeIn()+scaleIn(),exit=slideOutVertically{-it/2}+fadeOut()){Surface(color=DarkGreen,shape=RoundedCornerShape(50),shadowElevation=4.dp,modifier=Modifier.padding(top=5.dp)){Row(Modifier.padding(horizontal=10.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically){Icon(Icons.Outlined.ShoppingCart,null,tint=Color.White,modifier=Modifier.size(15.dp));Spacer(Modifier.width(5.dp));Text("+1 Cart",fontSize=11.sp,fontWeight=FontWeight.Bold,color=Color.White)}}}};BarcodeField("Search product / Scan barcode",query){value->query=value;if(value.isNotBlank()){val exact=products.firstOrNull{it.optString("barcode").equals(value,true)||it.optString("sku").equals(value,true)};if(exact!=null){add(exact);query=""}}};JsonChoice("Category",category,jsonObjects(state.categories),{it.optString("name")}){category=it};Spacer(Modifier.height(7.dp));LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(8.dp)){items(products.take(50)){ProductRow(it,stock(it)-(cart.firstOrNull{line->line.product.optString("id")==it.optString("id")}?.quantity?:0)){add(it)}}};Button({editCart=true},enabled=cart.isNotEmpty(),modifier=Modifier.fillMaxWidth().height(52.dp)){Text("Edit cart & checkout · ${money(total)}",fontWeight=FontWeight.Bold)}}
    if(editCart)CartEditorDialog(cart,{editCart=false},{editCart=false;checkout=true});if(checkout)CheckoutDialog(cart,state,{checkout=false}){customer,name,phone,method,payments->vm.completeSale(cart.toList(),customer,name,phone,method,payments){ok->if(ok){playSuccess();cart.clear();checkout=false}}}
}

@Composable private fun CartEditorDialog(cart:MutableList<SaleLine>,close:()->Unit,checkout:()->Unit){AlertDialog(onDismissRequest=close,title={Text("Current cart")},text={LazyColumn(verticalArrangement=Arrangement.spacedBy(8.dp)){items(cart.size){i->val line=cart[i];Card{Column(Modifier.padding(10.dp)){Row(verticalAlignment=Alignment.CenterVertically){Text(productName(line.product),Modifier.weight(1f),fontWeight=FontWeight.Bold);IconButton({cart.removeAt(i)}){Icon(Icons.Outlined.Delete,null,tint=Color.Red)}};Row(horizontalArrangement=Arrangement.spacedBy(6.dp),verticalAlignment=Alignment.CenterVertically){OutlinedButton({if(line.quantity>1)cart[i]=line.copy(quantity=line.quantity-1)}){Text("-")};Text(line.quantity.toString(),fontWeight=FontWeight.Bold);OutlinedButton({if(line.quantity<stock(line.product))cart[i]=line.copy(quantity=line.quantity+1)}){Text("+")};Box(Modifier.weight(1f)){NumberField("Price",line.unitPrice.toString()){cart[i]=line.copy(unitPrice=it.toDoubleOrNull()?:0.0)}}};Text("Total ${money(line.quantity*line.unitPrice)}",fontSize=12.sp,color=Green)}}};item{Text("Sale total ${money(cart.sumOf{it.quantity*it.unitPrice})}",fontSize=19.sp,fontWeight=FontWeight.ExtraBold)}}},dismissButton={TextButton(close){Text("Continue sale")}},confirmButton={Button(checkout,enabled=cart.isNotEmpty()){Text("Save & checkout")}})}

@Composable private fun CheckoutDialog(cart:List<SaleLine>,state:AppState,close:()->Unit,save:(JSONObject?,String,String,String,List<SalePayment>)->Unit){var customer by remember{mutableStateOf<JSONObject?>(null)};var name by remember{mutableStateOf("")};var phone by remember{mutableStateOf("")};var method by remember{mutableStateOf("CASH")};var split by remember{mutableStateOf(false)};val payments=remember{mutableStateListOf(SalePayment("CASH",0.0),SalePayment("KPAY",0.0))};val total=cart.sumOf{it.quantity*it.unitPrice};AlertDialog(onDismissRequest=close,title={Text("Customer & payment")},text={LazyColumn(verticalArrangement=Arrangement.spacedBy(9.dp)){item{Text("${cart.sumOf{it.quantity}} items · ${money(total)}",fontWeight=FontWeight.Bold)};item{JsonChoice("Customer",customer,jsonObjects(state.customers),{it.optString("name")}){customer=it}};if(customer==null){item{Field("Customer name (optional)",name){name=it}};item{Field("Phone (optional)",phone){phone=it}}};item{Row(verticalAlignment=Alignment.CenterVertically){Text("Split payment",Modifier.weight(1f));Switch(split,{split=it})}};if(!split)item{StringChoice("Payment type",method,listOf("CASH","KPAY","WAVE_PAY","CREDIT","OTHER")){method=it}};if(split){items(payments.size){i->val p=payments[i];Column{StringChoice("Method ${i+1}",p.method,listOf("CASH","KPAY","WAVE_PAY","OTHER")){payments[i]=p.copy(method=it)};NumberField("Amount",if(p.amount==0.0)"" else p.amount.toString()){payments[i]=p.copy(amount=it.toDoubleOrNull()?:0.0)}}};item{TextButton({payments.add(SalePayment("CASH",0.0))}){Text("+ Add payment")}}}}},dismissButton={TextButton(close){Text("Back")}},confirmButton={val valid=!split||kotlin.math.abs(payments.sumOf{it.amount}-total)<.01;Button({save(customer,name,phone,method,if(split)payments.filter{it.amount>0}else emptyList())},enabled=valid&&(method!="CREDIT"||customer!=null||name.isNotBlank())){Text("Complete sale")}})}

@Composable private fun ProductRow(item: JSONObject, shownStock:Int=stock(item), onClick: (() -> Unit)? = null) {val image=productImage(item);Card(Modifier.fillMaxWidth().then(if(onClick!=null) Modifier.clickable{onClick()} else Modifier), shape=RoundedCornerShape(17.dp)) { Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically){Surface(color=Color(0xFFE8F7EF),shape=RoundedCornerShape(14.dp),modifier=Modifier.size(52.dp)){Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center){CategoryProductIcon(item);if(image.isNotBlank())AsyncImage(model=image,contentDescription=productName(item),contentScale=ContentScale.Crop,modifier=Modifier.fillMaxSize())}}; Spacer(Modifier.width(12.dp)); Column(Modifier.weight(1f)){Text(productName(item),fontWeight=FontWeight.Bold,maxLines=2,overflow=TextOverflow.Ellipsis);val cat=item.optJSONObject("category")?.optString("name").orEmpty();if(cat.isNotBlank())Text(cat,fontSize=11.sp,color=Color.Gray);Text(if(shownStock>0)"Stock $shownStock" else "Out of stock",fontSize=12.sp,color=if(shownStock>0) Green else Color.Red)}; Text(money(price(item)),fontWeight=FontWeight.ExtraBold,color=DarkGreen) } } }

@Composable private fun CategoryProductIcon(item:JSONObject){Icon(categoryIcon(item),contentDescription=null,modifier=Modifier.size(30.dp),tint=Color(0xFF087A52))}


@Composable private fun RepairDialog(close:()->Unit,save:(String,String,String,String,String,Double,Double)->Unit){var customer by remember{mutableStateOf("")};var phone by remember{mutableStateOf("")};var brand by remember{mutableStateOf("")};var model by remember{mutableStateOf("")};var problem by remember{mutableStateOf("")};var estimate by remember{mutableStateOf("")};var deposit by remember{mutableStateOf("")};AlertDialog(onDismissRequest=close,title={Text("Add repair")},text={LazyColumn(verticalArrangement=Arrangement.spacedBy(8.dp)){item{Field("Customer name",customer){customer=it}};item{Field("Phone",phone){phone=it}};item{Field("Device brand",brand){brand=it}};item{Field("Device model",model){model=it}};item{Field("Problem",problem){problem=it}};item{NumberField("Estimated cost",estimate){estimate=it}};item{NumberField("Deposit",deposit){deposit=it}}}},dismissButton={TextButton(close){Text("Cancel")}},confirmButton={Button({save(customer,phone,brand,model,problem,estimate.toDoubleOrNull()?:0.0,deposit.toDoubleOrNull()?:0.0)},enabled=customer.isNotBlank()&&model.isNotBlank()&&problem.isNotBlank()){Text("Create repair")}})}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun EnhancedRepairsScreen(state:AppState,vm:MainViewModel){
    var add by remember{mutableStateOf(false)}; var selected by remember{mutableStateOf<JSONObject?>(null)};var view by remember{mutableStateOf("Pending")};val all=jsonObjects(state.repairs);val doneStatuses=setOf("COMPLETED","DELIVERED","CANNOT_REPAIR");val data=all.filter{if(view=="Done")it.optString("status") in doneStatuses else it.optString("status") !in doneStatuses}
    Column(Modifier.fillMaxSize().padding(16.dp)){
        Row(verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text("Repair history",fontWeight=FontWeight.ExtraBold,fontSize=22.sp);Text("${data.size} repair jobs",color=Color.Gray)};Button({add=true}){Icon(Icons.Outlined.Add,null);Text(" Add repair")}}
        Spacer(Modifier.height(10.dp));SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()){listOf("Pending","Done").forEachIndexed{i,label->SegmentedButton(selected=view==label,onClick={view=label},shape=SegmentedButtonDefaults.itemShape(i,2)){Text("$label (${all.count{if(label=="Done")it.optString("status") in doneStatuses else it.optString("status") !in doneStatuses}})")}}};Spacer(Modifier.height(10.dp))
        LazyColumn(verticalArrangement=Arrangement.spacedBy(9.dp)){items(data){r->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(15.dp)){Text(r.optString("repairNumber",r.optString("id")),color=Green,fontWeight=FontWeight.Bold);Text("${r.optString("deviceBrand")} ${r.optString("deviceModel")}",fontWeight=FontWeight.ExtraBold,fontSize=18.sp);Text("${r.optString("customerName")} · ${r.optString("customerPhone")}",color=Color.Gray);Text(r.optString("problem"),maxLines=2);AssistChip(onClick={selected=r},label={Text(r.optString("status","RECEIVED"))},trailingIcon={Icon(Icons.Outlined.ArrowDropDown,null)})}}}}
    }
    if(add)RepairDialog({add=false}){a,b,c,d,e,f,g->vm.createRepair(a,b,c,d,e,f,g){if(it)add=false}}
    selected?.let{r->StringSelectDialog("Change repair status",r.optString("status"),listOf("RECEIVED","CHECKING","IN_PROGRESS","WAITING_PART","COMPLETED","CANNOT_REPAIR","DELIVERED"),{selected=null}){newStatus->vm.updateRepairStatus(r.optString("id"),newStatus){ok->if(ok)selected=null}}}
}

@Composable private fun EnhancedMoreScreen(sales:JSONArray,open:(Page)->Unit){val links=listOf(Triple("Sales history",Icons.AutoMirrored.Outlined.ReceiptLong,Page.HISTORY),Triple("Money service",Icons.Outlined.AccountBalanceWallet,Page.MONEY),Triple("Expense",Icons.AutoMirrored.Outlined.TrendingDown,Page.EXPENSE),Triple("Other income",Icons.AutoMirrored.Outlined.TrendingUp,Page.INCOME),Triple("Daily close reports",Icons.Outlined.BarChart,Page.REPORTS),Triple("POS & print settings",Icons.Outlined.Print,Page.SETTINGS),Triple("About us",Icons.Outlined.Info,Page.ABOUT));LazyColumn(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(9.dp)){item{SectionTitle("Operations")};items(links){(name,icon,page)->Card(Modifier.fillMaxWidth().clickable{open(page)}){Row(Modifier.padding(17.dp),verticalAlignment=Alignment.CenterVertically){Icon(icon,null,tint=Green);Spacer(Modifier.width(13.dp));Text(name,Modifier.weight(1f),fontWeight=FontWeight.Bold);Icon(Icons.Outlined.ChevronRight,null)}}};item{Text("${sales.length()} sales loaded securely",color=Color.Gray)}}}


@Composable private fun MoneyServiceScreen(state:AppState,vm:MainViewModel,initialTab:Int=0){
    val tabs=listOf("Transfer","Cash out","Bill / Eload","Refill","Adjust","History");var tab by remember(initialTab){mutableIntStateOf(initialTab)}
    Column(Modifier.fillMaxSize()){ScrollableTabRow(tab,edgePadding=12.dp){tabs.forEachIndexed{i,s->Tab(tab==i,{tab=i},text={Text(s)})}};when(tab){0->MoneyTransferForm(state,vm,"TRANSFER");1->MoneyTransferForm(state,vm,"CASH_OUT");2->BillerForm(state,vm,"SOLD");3->BillerForm(state,vm,"REFILL");4->BillerForm(state,vm,"ADJUSTMENT");else->MoneyHistory(state,vm)}}
}

@Composable private fun MoneyTransferForm(state:AppState,vm:MainViewModel,mode:String){
    val methods=jsonObjects(state.moneySettings.optJSONArray("paymentMethods")?:JSONArray()).filter{it.optBoolean("supportsMoneyService",true)&&it.optString("accountId").isNotBlank()};val accounts=jsonObjects(state.moneySettings.optJSONArray("accounts")?:JSONArray())
    var method by remember(methods){mutableStateOf(methods.firstOrNull())};var cash by remember(accounts,method){mutableStateOf(accounts.firstOrNull{it.optString("id")!=method?.optString("accountId")})};var amount by remember{mutableStateOf("")};var name by remember{mutableStateOf("")};var phone by remember{mutableStateOf("")};var fee by remember{mutableStateOf("0")};var timing by remember{mutableStateOf("PAID_NOW")};var paid by remember{mutableStateOf("")}
    val summary=state.moneyDashboard.optJSONObject("summary")?:state.moneyDashboard.optJSONObject("data")?:state.moneyDashboard
    LazyColumn(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){item{Text(if(mode=="TRANSFER")"Money transfer" else "Cash out",fontSize=22.sp,fontWeight=FontWeight.ExtraBold)};item{MiniSummary(if(mode=="TRANSFER")"Today transferred" else "Today cash out",money(findNumber(summary,if(mode=="TRANSFER")"todayTransferAmount" else "todayCashOutAmount")),"Today fees",money(findNumber(summary,"todayFee")))};item{JsonChoice("Wallet",method,methods,{it.optString("name")}){selected->method=selected;cash=accounts.firstOrNull{a->a.optString("id")!=selected?.optString("accountId")}}};item{JsonChoice("Cash / collection account",cash,accounts.filter{it.optString("id")!=method?.optString("accountId")},{"${it.optString("name")} · ${money(it.optDouble("balance"))}"}){cash=it}};item{NumberField("Amount",amount){amount=it}};item{Field(if(mode=="TRANSFER")"Receiver name" else "Withdrawer name (optional)",name){name=it}};item{Field(if(mode=="TRANSFER")"Receiver phone" else "Phone (optional)",phone){phone=it}};item{NumberField("Service fee",fee){fee=it}};item{StringChoice("Payment status",timing,listOf("PAID_NOW","PAY_LATER","PARTIAL")){timing=it}};if(timing=="PARTIAL")item{NumberField("Paid amount",paid){paid=it}};item{Button({vm.createMoney(mode,method?.optString("id").orEmpty(),cash?.optString("id").orEmpty(),amount.toDoubleOrNull()?:0.0,name,phone,fee.toDoubleOrNull()?:0.0,timing,paid.toDoubleOrNull()?:0.0){if(it){amount="";name="";phone=""}}},Modifier.fillMaxWidth(),enabled=method!=null&&cash!=null&&(amount.toDoubleOrNull()?:0.0)>0&&(mode!="TRANSFER"||(name.isNotBlank()&&phone.isNotBlank()))){Text("Save transaction")}};if(!state.error.isNullOrBlank())item{ErrorCard(state.error)}}
}

@Composable private fun BillerForm(state:AppState,vm:MainViewModel,kind:String){
    val billers=jsonObjects(state.moneySettings.optJSONArray("billers")?:JSONArray()).filter{it.optBoolean("isActive",true)};val accounts=jsonObjects(state.moneySettings.optJSONArray("accounts")?:JSONArray());var biller by remember(billers){mutableStateOf(billers.firstOrNull())};var account by remember(accounts){mutableStateOf(accounts.firstOrNull())};var amount by remember{mutableStateOf("")};var note by remember{mutableStateOf("")};var addBiller by remember{mutableStateOf(false)};var timing by remember{mutableStateOf("PAID_NOW")};var paid by remember{mutableStateOf("")}
    val today=todayText();val todayRows=jsonObjects(state.billerTransactions).filter{it.optString("transactionDate",it.optString("createdAt")).startsWith(today)};val kindTotal=todayRows.filter{it.optString("transactionType")==kind}.sumOf{it.optDouble("amount")};val balance=billers.sumOf{it.optDouble("currentBalance")}
    LazyColumn(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){item{Row(verticalAlignment=Alignment.CenterVertically){Text(when(kind){"SOLD"->"Bill / Eload sale";"REFILL"->"Balance refill";else->"Balance adjustment"},fontSize=22.sp,fontWeight=FontWeight.ExtraBold,modifier=Modifier.weight(1f));TextButton({addBiller=true}){Text("+ Biller")}}};item{MiniSummary("Today ${kind.lowercase()}",money(kindTotal),"Total biller balance",money(balance))};item{JsonChoice("Biller",biller,billers,{"${it.optString("name")} · ${money(it.optDouble("currentBalance"))}"}){biller=it}};item{NumberField(if(kind=="ADJUSTMENT")"Adjustment (+ / -)" else "Amount",amount){amount=it}};if(kind!="ADJUSTMENT")item{JsonChoice("Payment account",account,accounts,{"${it.optString("name")} · ${money(it.optDouble("balance"))}"}){account=it}};if(kind=="SOLD")item{StringChoice("Payment status",timing,listOf("PAID_NOW","PAY_LATER","PARTIAL")){timing=it}};if(kind=="SOLD"&&timing=="PARTIAL")item{NumberField("Paid amount",paid){paid=it}};item{Field(if(kind=="ADJUSTMENT")"Reason (required)" else "Note",note){note=it}};item{Button({vm.createBillerTransaction(kind,biller?.optString("id").orEmpty(),amount.toDoubleOrNull()?:0.0,account?.optString("id"),note,if(kind=="SOLD")timing else "PAID_NOW",paid.toDoubleOrNull()?:0.0){if(it){amount="";note=""}}},Modifier.fillMaxWidth(),enabled=biller!=null&&(amount.toDoubleOrNull()?:0.0)!=0.0&&(kind!="ADJUSTMENT"||note.isNotBlank())){Text("Save")}};if(!state.error.isNullOrBlank())item{ErrorCard(state.error)}}
    if(addBiller)AddBillerDialog({addBiller=false}){n,t,o->vm.createBiller(n,t,o){if(it)addBiller=false}}
}

@Composable private fun AddBillerDialog(close:()->Unit,save:(String,String,Double)->Unit){var name by remember{mutableStateOf("")};var type by remember{mutableStateOf("ELOAD")};var opening by remember{mutableStateOf("0")};AlertDialog(onDismissRequest=close,title={Text("Add biller")},text={Column(verticalArrangement=Arrangement.spacedBy(9.dp)){Field("Biller name",name){name=it};StringChoice("Type",type,listOf("TOPUP_CARD","ELOAD","BILL_PAYMENT","OTHER")){type=it};NumberField("Opening balance",opening){opening=it}}},dismissButton={TextButton(close){Text("Cancel")}},confirmButton={Button({save(name,type,opening.toDoubleOrNull()?:0.0)},enabled=name.isNotBlank()){Text("Create")}})}

@Composable private fun MoneyHistory(state:AppState,vm:MainViewModel){var date by remember{mutableStateOf(todayText())};val money=jsonObjects(state.moneyTransactions).filter{it.optString("transactionDate",it.optString("createdAt")).startsWith(date)};val bills=jsonObjects(state.billerTransactions).filter{it.optString("transactionDate",it.optString("createdAt")).startsWith(date)};var collect by remember{mutableStateOf<JSONObject?>(null)};var detail by remember{mutableStateOf<JSONObject?>(null)};LazyColumn(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(9.dp)){item{Text("Money service history",fontSize=20.sp,fontWeight=FontWeight.ExtraBold)};item{DateButton("Date",date){date=it}};item{MiniSummary("Transactions",(money.size+bills.size).toString(),"Total volume",money(money.sumOf{it.optDouble("amount")}+bills.sumOf{it.optDouble("amount")}))};items(money){r->Box(Modifier.clickable{detail=r}){HistoryRow(r.optString("transactionNumber","Transaction"),"${r.optString("mode")} · ${r.optString("paymentStatus")}",r.optDouble("amount"),if(r.optDouble("dueAmount")>0){{collect=r}}else null)}};item{Text("Bill / Eload",fontSize=18.sp,fontWeight=FontWeight.ExtraBold,modifier=Modifier.padding(top=8.dp))};items(bills){r->Box(Modifier.clickable{detail=r}){HistoryRow(r.optString("billerName","Biller"),"${r.optString("transactionType")} · ${r.optString("paymentStatus")}",r.optDouble("amount"),null)}}};detail?.let{JsonDetailDialog("Transaction detail",it){detail=null}};if(collect!=null)CollectDialog(collect!!,jsonObjects(state.moneySettings.optJSONArray("accounts")?:JSONArray()),{collect=null}){account,amount->vm.collectMoney(collect!!.optString("id"),account,amount){if(it)collect=null}}}
@Composable private fun HistoryRow(title:String,subtitle:String,amount:Double,action:(()->Unit)?){Card(Modifier.fillMaxWidth(),shape=RoundedCornerShape(16.dp)){Row(Modifier.padding(14.dp),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text(title,fontWeight=FontWeight.Bold);Text(subtitle,color=Color.Gray,fontSize=12.sp)};Column(horizontalAlignment=Alignment.End){Text(money(amount),fontWeight=FontWeight.ExtraBold);if(action!=null)TextButton(action){Text("Collect")}}}}}
@Composable private fun CollectDialog(record:JSONObject,accounts:List<JSONObject>,close:()->Unit,save:(String,Double)->Unit){var account by remember(accounts){mutableStateOf(accounts.firstOrNull())};var amount by remember{mutableStateOf(record.optDouble("dueAmount").toString())};AlertDialog(onDismissRequest=close,title={Text("Collect payment")},text={Column(verticalArrangement=Arrangement.spacedBy(9.dp)){Text("Due ${money(record.optDouble("dueAmount"))}");JsonChoice("Account",account,accounts,{it.optString("name")}){account=it};NumberField("Amount",amount){amount=it}}},dismissButton={TextButton(close){Text("Cancel")}},confirmButton={Button({save(account?.optString("id").orEmpty(),amount.toDoubleOrNull()?:0.0)},enabled=account!=null&&(amount.toDoubleOrNull()?:0.0)>0){Text("Collect")}})}

@Composable private fun RecordListScreen(title:String, records:JSONArray, icon:ImageVector){val data=jsonObjects(records);LazyColumn(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(9.dp)){item{Column{Text(title,fontWeight=FontWeight.ExtraBold,fontSize=20.sp);Text("${data.size} records",color=Color.Gray)}};items(data){r->Card(Modifier.fillMaxWidth(),shape=RoundedCornerShape(17.dp)){Row(Modifier.padding(15.dp),verticalAlignment=Alignment.CenterVertically){Icon(icon,null,tint=Green);Spacer(Modifier.width(12.dp));Column(Modifier.weight(1f)){Text(r.optString("invoice",r.optString("invoiceNo",r.optString("reference",r.optString("id","Record")))),fontWeight=FontWeight.Bold,maxLines=1);Text(r.optString("status",r.optString("transactionType","Completed")),fontSize=12.sp,color=Color.Gray)};Text(money(r.optDouble("amount",r.optDouble("total",0.0))),fontWeight=FontWeight.ExtraBold)}}}}}

@Composable private fun SalesHistoryScreen(state:AppState,vm:MainViewModel){var from by remember{mutableStateOf(todayText())};var to by remember{mutableStateOf(todayText())};var query by remember{mutableStateOf("")};var detail by remember{mutableStateOf<JSONObject?>(null)};val rows=jsonObjects(state.sales);val summary=state.salesData.optJSONObject("summary")?:state.salesData;LazyColumn(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(9.dp)){item{Text("Sales history",fontSize=22.sp,fontWeight=FontWeight.ExtraBold)};item{MiniSummary("Sales",findNumber(summary,"count","saleCount","totalSales").toInt().takeIf{it>0}?.toString()?:rows.size.toString(),"Amount",money(findNumber(summary,"totalAmount","amount","total")))};item{Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Box(Modifier.weight(1f)){DateButton("From",from){from=it}};Box(Modifier.weight(1f)){DateButton("To",to){to=it}}}};item{Field("Invoice / customer",query){query=it}};item{Button({vm.loadSales(from,to,query)},Modifier.fillMaxWidth()){Text("Search history")}};items(rows){sale->Card(Modifier.fillMaxWidth().clickable{vm.loadSaleDetail(sale.optString("id")){detail=it?:sale}},shape=RoundedCornerShape(16.dp)){Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){Row{Text(sale.optString("invoiceNo",sale.optString("invoice","Sale")),Modifier.weight(1f),fontWeight=FontWeight.Bold);Text(money(findNumber(sale,"grandTotal","total","amount")),fontWeight=FontWeight.ExtraBold)};Text(sale.optString("items","${sale.optInt("itemCount")} items"),maxLines=2,overflow=TextOverflow.Ellipsis);Text(sale.optString("soldAt",sale.optString("createdAt")),fontSize=11.sp,color=Color.Gray)}}}};detail?.let{SaleDetailDialog(it){detail=null}}}

@Composable private fun SaleDetailDialog(sale:JSONObject,close:()->Unit){val lines=jsonObjects(sale.optJSONArray("items")?:sale.optJSONArray("saleItems")?:JSONArray());AlertDialog(onDismissRequest=close,title={Text(sale.optString("invoiceNo",sale.optString("invoice","Sale detail")))},text={LazyColumn(verticalArrangement=Arrangement.spacedBy(8.dp)){item{Text("${sale.optString("customerName","Walk-in customer")}\n${sale.optString("soldAt",sale.optString("createdAt"))}",color=Color.Gray)};items(lines){line->Row(Modifier.fillMaxWidth()){Column(Modifier.weight(1f)){Text(line.optString("productNameSnapshot",line.optString("productName",line.optString("name","Item"))),fontWeight=FontWeight.Bold);Text("Qty ${line.optInt("quantity",1)} × ${money(findNumber(line,"unitPrice","price"))}",fontSize=12.sp,color=Color.Gray)};Text(money(findNumber(line,"lineTotal","total","amount")),fontWeight=FontWeight.Bold)}};item{HorizontalDivider();Row{Text("Total",Modifier.weight(1f),fontWeight=FontWeight.Bold);Text(money(findNumber(sale,"grandTotal","total","amount")),fontWeight=FontWeight.ExtraBold)}}}},confirmButton={Button(close){Text("Close")}})}

@Composable private fun ReportScreen(state:AppState,vm:MainViewModel){val context=LocalContext.current;var date by remember{mutableStateOf(todayText())};var confirm by remember{mutableStateOf(false)};val data=state.report.optJSONObject("dashboard")?:state.report.optJSONObject("report")?:state.report.optJSONObject("data")?:state.report;val metrics=listOf("Total income" to findNumber(data,"todayTotalIncome","incomeTotal","totalIncome","income"),"Product sales" to findNumber(data,"todaySaleIncome","salePosIncome","productSales","sales"),"Expenses" to findNumber(data,"todayExpense","expenseTotal","totalExpense","expense"),"Net profit" to findNumber(data,"todayProfit","netProfit","profit"));LazyColumn(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){item{Surface(color=DarkGreen,shape=RoundedCornerShape(24.dp)){Column(Modifier.padding(22.dp)){Text("Daily close",color=Color.White,fontSize=24.sp,fontWeight=FontWeight.ExtraBold);Text("Select a date, review, close and print",color=Color(0xFFBDE9D3))}}};item{DateButton("Business date",date){date=it;vm.loadReport(it)}};items(metrics){(label,value)->StatCard(label,money(value),if(value>=0)Green else Color.Red,Modifier.fillMaxWidth())};item{Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button({confirm=true},Modifier.weight(1f)){Text("Close day")};OutlinedButton({printDailyClose(context,date,metrics)},Modifier.weight(1f)){Icon(Icons.Outlined.Print,null);Text(" Print slip")}}}};if(confirm)AlertDialog(onDismissRequest={confirm=false},title={Text("Close $date?")},text={Text("This will create the Daily Close record for the selected date.")},dismissButton={TextButton({confirm=false}){Text("Cancel")}},confirmButton={Button({vm.closeBusinessDay(date,""){if(it)vm.loadReport(date)};confirm=false}){Text("Confirm close")}})}

@Composable private fun BusinessRecordScreen(type:String,state:AppState,vm:MainViewModel){var title by remember{mutableStateOf("")};var amount by remember{mutableStateOf("")};var method by remember{mutableStateOf("CASH")};var account by remember{mutableStateOf<JSONObject?>(null)};var category by remember{mutableStateOf<JSONObject?>(null)};var note by remember{mutableStateOf("")};val accounts=jsonObjects(state.moneySettings.optJSONArray("accounts")?:JSONArray());val categories=jsonObjects(state.financeCatalogs.optJSONArray(if(type=="income")"incomeCategories" else "expenseCategories")?:JSONArray()).filter{!it.has("active")||it.optBoolean("active")};LazyColumn(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){item{Text(if(type=="income")"Add other income" else "Add expense",fontSize=22.sp,fontWeight=FontWeight.ExtraBold)};if(categories.isNotEmpty())item{JsonChoice(if(type=="income")"Income category" else "Expense category",category,categories,{it.optString("name",it.optString("label"))}){category=it;title=it?.optString("name",it.optString("label")).orEmpty()}}else item{Text("No active category configured. Add one in Web App Settings.",color=Color.Gray)};item{NumberField("Amount",amount){amount=it}};item{StringChoice("Payment method",method,listOf("CASH","KPAY","WAVE_PAY","BANK","OTHER")){method=it}};item{JsonChoice("Account",account,accounts,{"${it.optString("name")} · ${money(it.optDouble("balance"))}"}){account=it}};item{Field("Note (optional)",note){note=it}};item{Button({vm.createBusinessRecord(type,title,amount.toDoubleOrNull()?:0.0,method,account?.optString("id"),note){if(it){title="";amount="";note="";category=null}}},Modifier.fillMaxWidth(),enabled=title.isNotBlank()&&(amount.toDoubleOrNull()?:0.0)>0){Text("Save")}};if(!state.error.isNullOrBlank())item{ErrorCard(state.error)}}}

@Composable private fun SettingsScreen(){val context=LocalContext.current;val prefs=context.getSharedPreferences("mahar_pos_print",android.content.Context.MODE_PRIVATE);var paper by remember{mutableStateOf(prefs.getString("paper","80 mm")?:"80 mm")};var autoPrint by remember{mutableStateOf(prefs.getBoolean("auto",false))};var copies by remember{mutableStateOf(prefs.getInt("copies",1).toString())};var footer by remember{mutableStateOf(prefs.getString("footer","Thank you")?:"Thank you")};var saved by remember{mutableStateOf(false)};LazyColumn(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){item{Text("POS & receipt printer",fontSize=22.sp,fontWeight=FontWeight.ExtraBold)};item{StringChoice("Paper size",paper,listOf("58 mm","80 mm")){paper=it}};item{NumberField("Copies",copies){copies=it}};item{Field("Receipt footer",footer){footer=it}};item{Row(verticalAlignment=Alignment.CenterVertically){Text("Print automatically after sale",Modifier.weight(1f));Switch(autoPrint,{autoPrint=it})}};item{Button({prefs.edit().putString("paper",paper).putBoolean("auto",autoPrint).putInt("copies",copies.toIntOrNull()?.coerceIn(1,5)?:1).putString("footer",footer).apply();saved=true},Modifier.fillMaxWidth()){Text("Save print settings")}};if(saved)item{Text("Settings saved on this device",color=Green,fontWeight=FontWeight.Bold)};item{Text("Bluetooth/USB printer connection uses the selected paper width. Printer discovery will appear when a supported printer is paired.",color=Color.Gray,fontSize=13.sp)}}}

@Composable private fun AboutScreen(){val context=LocalContext.current;LazyColumn(Modifier.fillMaxSize().padding(20.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)){item{Surface(color=Color.White,shape=RoundedCornerShape(22.dp)){Image(painterResource(R.drawable.mahar_pos_brand_logo),"Mahar POS",Modifier.fillMaxWidth(.68f).height(145.dp).padding(8.dp),contentScale=ContentScale.Fit)}};item{Text("Mahar POS",fontSize=25.sp,fontWeight=FontWeight.ExtraBold)};item{Text("Shop Management System",color=Color.Gray)};item{Text("Sales, products, stock, repairs, money service and daily reports securely connected to your shop's PostgreSQL data.",textAlign=androidx.compose.ui.text.style.TextAlign.Center)};item{Button({context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://app.maharshwe.shop/")))}){Text("Open Mahar POS website")}};item{OutlinedButton({}){Text("Version ${BuildConfig.VERSION_NAME}")}}}}

@Composable private fun StringSelectDialog(title:String,current:String,options:List<String>,close:()->Unit,save:(String)->Unit){var value by remember{mutableStateOf(current)};AlertDialog(onDismissRequest=close,title={Text(title)},text={Column{options.forEach{Row(Modifier.fillMaxWidth().clickable{value=it}.padding(10.dp),verticalAlignment=Alignment.CenterVertically){RadioButton(value==it,{value=it});Text(it)}}}},dismissButton={TextButton(close){Text("Cancel")}},confirmButton={Button({save(value)}){Text("Update")}})}

@Composable private fun ErrorCard(message:String){Surface(color=Color(0xFFFFE8E8),shape=RoundedCornerShape(16.dp)){Row(Modifier.padding(14.dp)){Icon(Icons.Outlined.ErrorOutline,null,tint=Color.Red);Spacer(Modifier.width(10.dp));Text(message,color=Color(0xFF8A1C1C))}}}
@Composable private fun MiniSummary(leftLabel:String,leftValue:String,rightLabel:String,rightValue:String){Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf(leftLabel to leftValue,rightLabel to rightValue).forEach{(label,value)->Surface(Modifier.weight(1f),color=Color(0xFFF0F7F3),shape=RoundedCornerShape(14.dp)){Column(Modifier.padding(11.dp)){Text(label,fontSize=11.sp,color=Color.Gray,maxLines=1,overflow=TextOverflow.Ellipsis);Text(value,fontSize=15.sp,fontWeight=FontWeight.ExtraBold,maxLines=1,overflow=TextOverflow.Ellipsis)}}}}}
@Composable private fun JsonDetailDialog(title:String,data:JSONObject,close:()->Unit){val keys=data.keys().asSequence().filter{data.opt(it)!is JSONObject&&data.opt(it)!is JSONArray}.toList();AlertDialog(onDismissRequest=close,title={Text(title)},text={LazyColumn(verticalArrangement=Arrangement.spacedBy(7.dp)){items(keys){key->Column{Text(key.replaceFirstChar{it.uppercase()},fontSize=11.sp,color=Color.Gray);Text(data.optString(key,"—"),fontWeight=FontWeight.SemiBold)}}}},confirmButton={Button(close){Text("Close")}})}
@Composable private fun BarcodeField(label:String,value:String,change:(String)->Unit){val context=LocalContext.current;OutlinedTextField(value,change,Modifier.fillMaxWidth(),label={Text(label)},singleLine=true,shape=RoundedCornerShape(14.dp),trailingIcon={IconButton({val options=GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS).enableAutoZoom().build();GmsBarcodeScanning.getClient(context,options).startScan().addOnSuccessListener{code->code.rawValue?.let(change)}}){Icon(Icons.Outlined.QrCodeScanner,"Scan barcode")}})}
@Composable private fun DateButton(label:String,value:String,change:(String)->Unit){val context=LocalContext.current;OutlinedButton({val parts=value.split("-").mapNotNull{it.toIntOrNull()};val calendar=java.util.Calendar.getInstance().apply{if(parts.size==3)set(parts[0],parts[1]-1,parts[2])};android.app.DatePickerDialog(context,{_,year,month,day->change("%04d-%02d-%02d".format(year,month+1,day))},calendar.get(java.util.Calendar.YEAR),calendar.get(java.util.Calendar.MONTH),calendar.get(java.util.Calendar.DAY_OF_MONTH)).show()},Modifier.fillMaxWidth(),shape=RoundedCornerShape(14.dp)){Column(Modifier.weight(1f)){Text(label,fontSize=11.sp,color=Color.Gray);Text(value,fontWeight=FontWeight.Bold)};Icon(Icons.Outlined.CalendarMonth,"Choose date")}}
@Composable private fun Field(label:String,value:String,change:(String)->Unit){OutlinedTextField(value,change,Modifier.fillMaxWidth(),label={Text(label)},singleLine=true,shape=RoundedCornerShape(14.dp))}
@Composable private fun NumberField(label:String,value:String,change:(String)->Unit){OutlinedTextField(value,change,Modifier.fillMaxWidth(),label={Text(label)},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal),shape=RoundedCornerShape(14.dp))}
@Composable private fun AutocompleteField(label:String,value:String,options:List<String>,change:(String)->Unit){var open by remember{mutableStateOf(false)};val matches=remember(value,options){if(value.isBlank())options.take(8)else options.filter{it.contains(value,true)}.take(8)};Box{OutlinedTextField(value,{change(it);open=true},Modifier.fillMaxWidth(),label={Text(label)},singleLine=true,shape=RoundedCornerShape(14.dp));DropdownMenu(open&&matches.isNotEmpty(),{open=false}){matches.forEach{option->DropdownMenuItem({Text(option)},{change(option);open=false})}}}}
@Composable private fun StringChoice(label:String,value:String,options:List<String>,choose:(String)->Unit){var open by remember{mutableStateOf(false)};Column{Text(label,fontSize=12.sp,color=Color.Gray);Box{OutlinedButton({open=true},Modifier.fillMaxWidth()){Text(value.ifBlank{"Select"},Modifier.weight(1f));Icon(Icons.Outlined.ArrowDropDown,null)};DropdownMenu(open,{open=false}){options.forEach{DropdownMenuItem({Text(it)},{choose(it);open=false})}}}}}
@Composable private fun JsonChoice(label:String,value:JSONObject?,options:List<JSONObject>,text:(JSONObject)->String,choose:(JSONObject?)->Unit){var open by remember{mutableStateOf(false)};Column{Text(label,fontSize=12.sp,color=Color.Gray);Box{OutlinedButton({open=true},Modifier.fillMaxWidth()){Text(value?.let(text)?:"Walk-in / Select",Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis);Icon(Icons.Outlined.ArrowDropDown,null)};DropdownMenu(open,{open=false}){DropdownMenuItem({Text("Walk-in / None")},{choose(null);open=false});options.forEach{item->DropdownMenuItem({Text(text(item))},{choose(item);open=false})}}}}}
private fun jsonObjects(a:JSONArray)=buildList{for(i in 0 until a.length())a.optJSONObject(i)?.let(::add)}
private fun jsonStrings(a:JSONArray)=buildList{for(i in 0 until a.length())a.optString(i).takeIf{it.isNotBlank()}?.let(::add)}
private fun findNumber(j:JSONObject,vararg keys:String):Double{
    val sources=listOfNotNull(j,j.optJSONObject("dashboard"),j.optJSONObject("totals"),j.optJSONObject("data"))
    for(source in sources)for(k in keys)if(source.has(k))return source.optDouble(k)
    return 0.0
}
private fun productName(j:JSONObject):String { val base=j.optString("productName",j.optString("name","Product"));val variant=j.optString("variantName");return if(variant.isBlank()||variant.equals("Default",true))base else "$base · $variant" }
private fun price(j:JSONObject)=listOf("standardSellingPrice","sellingPrice","price","salePrice","amount").firstNotNullOfOrNull{if(j.has(it))j.optDouble(it)else null}?:0.0
private fun stock(j:JSONObject)=listOf("stockQuantity","stock","quantity","stockQty","currentStock").firstNotNullOfOrNull{if(j.has(it))j.optInt(it)else null}?:0
private fun money(v:Double)="%,.0f MMK".format(v)
private fun productImage(j:JSONObject):String{val sources=listOfNotNull(j,j.optJSONObject("product"),j.optJSONObject("online"),j.optJSONObject("storefront"),j.optJSONObject("ecommerce"));for(source in sources){for(key in listOf("imageUrl","photoUrl","thumbnailUrl","primaryImageUrl","coverImageUrl","storeImageUrl","image")){val value=source.optString(key);if(value.isNotBlank())return absoluteImage(value)};for(arrayKey in listOf("images","photos","ecommerceImages","onlineImages","productImages")){val images=source.optJSONArray(arrayKey)?:continue;if(images.length()>0){val obj=images.optJSONObject(0);val first=images.optString(0).ifBlank{obj?.optString("url",obj.optString("imageUrl",obj.optString("path"))).orEmpty()};if(first.isNotBlank())return absoluteImage(first)}}};return ""}
private fun absoluteImage(value:String)=if(value.startsWith("/"))"https://app.maharshwe.shop$value" else value
private fun todayText()=java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.US).apply{timeZone=java.util.TimeZone.getTimeZone("Asia/Yangon")}.format(java.util.Date())
private fun printDailyClose(context:android.content.Context,date:String,metrics:List<Pair<String,Double>>){val prefs=context.getSharedPreferences("mahar_pos_print",android.content.Context.MODE_PRIVATE);val paper=prefs.getString("paper","80 mm")?:"80 mm";val copies=prefs.getInt("copies",1).coerceIn(1,5);val footer=prefs.getString("footer","Thank you")?:"Thank you";val width=if(paper.startsWith("58"))"58mm" else "80mm";val rows=metrics.joinToString(""){"<tr><td>${it.first}</td><td style='text-align:right'>${money(it.second)}</td></tr>"};val slip="<section><h2>Mahar POS</h2><h3>Daily Close · $date</h3><table>$rows</table><p class='footer'>$footer</p></section>";val pages=(1..copies).joinToString(""){slip};val html="<html><head><style>@page{size:$width auto;margin:3mm}body{width:$width;margin:0;font-family:sans-serif}section{padding:2mm;page-break-after:always}section:last-child{page-break-after:auto}h2,h3{text-align:center;margin:3px}table{width:100%;font-size:12px;border-collapse:collapse}td{padding:5px 0;border-bottom:1px dashed #aaa}.footer{text-align:center;font-size:11px}</style></head><body>$pages</body></html>";val web=WebView(context);web.webViewClient=object:WebViewClient(){override fun onPageFinished(view:WebView,url:String?){val manager=context.getSystemService(android.content.Context.PRINT_SERVICE) as PrintManager;manager.print("Mahar POS Daily Close $date",view.createPrintDocumentAdapter("Daily Close $date"),PrintAttributes.Builder().setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME).build())}};web.loadDataWithBaseURL(null,html,"text/html","UTF-8",null)}
private fun categoryIcon(j:JSONObject):ImageVector{val value=(j.optJSONObject("category")?.optString("name").orEmpty()+" "+j.optString("categoryName")+" "+j.optString("brand")+" "+productName(j)).lowercase();return when{value.contains("phone")||value.contains("mobile")||value.contains("ဖုန်း")->Icons.Outlined.PhoneAndroid;value.contains("charger")||value.contains("cable")||value.contains("accessor")||value.contains("အားသွင်း")||value.contains("ကြိုး")->Icons.Outlined.Cable;value.contains("head")||value.contains("ear")||value.contains("audio")||value.contains("နားကြပ်")->Icons.Outlined.Headphones;value.contains("game")->Icons.Outlined.SportsEsports;value.contains("card")||value.contains("gift")||value.contains("topup")||value.contains("eload")||value.contains("ဘေ")->Icons.Outlined.CardGiftcard;value.contains("spare")||value.contains("repair")||value.contains("မှန်")||value.contains("အပိုပစ္စည်း")->Icons.Outlined.Build;value.contains("electronic")||value.contains("gadget")->Icons.Outlined.DevicesOther;else->Icons.Outlined.Inventory2}}
private fun playTone(){runCatching{ToneGenerator(AudioManager.STREAM_NOTIFICATION,55).apply{startTone(ToneGenerator.TONE_PROP_BEEP,90);android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({release()},150)}}}
private fun playSuccess(){runCatching{ToneGenerator(AudioManager.STREAM_NOTIFICATION,70).apply{startTone(ToneGenerator.TONE_PROP_ACK,180);android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({release()},240)}}}





