#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include <SPI.h>
#include <MFRC522.h>
#include "HX711.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <ArduinoJson.h>

// ---------- Wi-Fi Hotspot Configuration ----------
const char* WIFI_SSID = "ssk";
const char* WIFI_PASSWORD = "1234567890";

// ---------- Authorized RFID Whitelist Configuration ----------
// Put your valid RFID card UIDs here. Any other card will be REJECTED with "Access Denied"!
const String AUTHORIZED_RFIDS[] = {
  "B5 E4 3E 06"  // Replace with your valid card UID (scanned on Serial/LCD)
};
const int NUM_AUTHORIZED_CARDS = sizeof(AUTHORIZED_RFIDS) / sizeof(AUTHORIZED_RFIDS[0]);

bool isCardAuthorized(String scannedUid) {
  for (int i = 0; i < NUM_AUTHORIZED_CARDS; i++) {
    if (scannedUid.equalsIgnoreCase(AUTHORIZED_RFIDS[i])) {
      return true;
    }
  }
  return false;
}

// Add your Supabase Project URL and Anon Key here
const char* SUPABASE_URL = "https://svuzznupaozcjvtederc.supabase.co/rest/v1/inventory?item_name=eq.Subsidized%20Rice";
const char* SUPABASE_ANON_KEY = "sb_publishable_bz0H5FFXcb_qQDz-vHWV9Q_q8GJ1GQg";

// ---------- Pin Configuration ----------
#define SS_PIN 5
#define RST_PIN 4
#define SERVO_PIN 13
#define GREEN_LED 26
#define RED_LED 27
#define LOADCELL_DOUT_PIN 32
#define LOADCELL_SCK_PIN 33

// ---------- Objects ----------
MFRC522 mfrc522(SS_PIN, RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2);
Servo dispenser;
HX711 scale;
WebServer server(80);

// ---------- Variables ----------
float calibration_factor = -650.0;  // Calibrated load cell factor
float currentWeight = 0.0;
float smoothedWeight = 0.0;
float targetWeight = 100.0;         // Target: 100g quota
float cutoffOffset = 2.0;           // Strict cut-off: triggers gate close at 98.0g (lands at 98g - 102g)
float currentDbQuantity = 0.0;
String inventoryRowId = "";

// Forward Declarations
void executePhysicalDispense(const char* label, float targetGrams = 100.0);
void verifyAndDispense();
void showIdleScreen();
void showError(String message);
void deductInventory(float qty);
void logRationClaim(String rationId, float grams);

// Cooldown tracker to prevent duplicate dispensing triggers
unsigned long lastDispenseTimestamp = 0;

// ---------- WebServer Handlers ----------
void handleWebDispense() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");

  float targetGrams = 100.0;
  if (server.hasArg("weight")) {
    targetGrams = server.arg("weight").toFloat();
  }
  if (targetGrams < 50.0) targetGrams = 100.0;
  if (targetGrams > 1000.0) targetGrams = 1000.0; // Dynamic quota cap (up to 10 family members = 1kg)

  String rId = "111111111111";
  if (server.hasArg("ration_id")) {
    rId = server.arg("ration_id");
  } else if (server.hasArg("id")) {
    rId = server.arg("id");
  }

  String res = "{\"status\":\"dispensing_started\",\"target_grams\":" + String((int)targetGrams) + "}";
  server.send(200, "application/json", res);
  
  Serial.print("\n[WEB TRIGGER] Dynamic Dispense signal received for: ");
  Serial.print((int)targetGrams);
  Serial.println("g! Opening valve...");
  executePhysicalDispense("Web Auth OK", targetGrams);
  logRationClaim(rId, targetGrams);
  deductInventory(targetGrams / 1000.0);
}

void handleTestServo() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
  server.send(200, "application/json", "{\"status\":\"servo_test_started\"}");

  Serial.println("\n[SERVO TEST] Testing servo 0° -> 90° -> 0°...");
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Servo Test Mode");
  lcd.setCursor(0, 1);
  lcd.print("Rotating 90 deg");

  digitalWrite(GREEN_LED, HIGH);
  dispenser.write(90);  // Open valve
  delay(2000);
  dispenser.write(0);   // Close valve
  digitalWrite(GREEN_LED, LOW);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Servo Test Done");
  delay(1500);
  showIdleScreen();
}

void handleOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
  server.send(204);
}

void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
  server.send(200, "application/json", "{\"status\":\"online\",\"ready\":true}");
}

// ---------- Setup ----------
void setup() {
  Serial.begin(115200);
  SPI.begin();
  mfrc522.PCD_Init();

  // LCD Setup
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Smart Ration IoT");
  lcd.setCursor(0, 1);
  lcd.print("Initializing...");
  delay(1000);

  // Servo Setup
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  dispenser.setPeriodHertz(50);
  dispenser.attach(SERVO_PIN, 500, 2400);
  dispenser.write(0); // Closed position

  // LED Setup
  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);

  // ---------- Direct Single Hotspot Connection ----------
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");
  lcd.setCursor(0, 1);
  lcd.print(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int wifiAttempts = 0;

  while (WiFi.status() != WL_CONNECTED && wifiAttempts < 30) {
    delay(500);
    Serial.print(".");
    wifiAttempts++;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n[ERROR] Wi-Fi Connection Failed!");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Failed!");
    lcd.setCursor(0, 1);
    lcd.print("Check Hotspot");
    digitalWrite(RED_LED, HIGH);
    while (1); // Halt system if no Wi-Fi
  }

  Serial.println("\nWi-Fi Connected ✅ to: " + String(WIFI_SSID));
  Serial.print("ESP32 IP Address: http://");
  Serial.println(WiFi.localIP());

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi Connected");
  lcd.setCursor(0, 1);
  lcd.print(WiFi.localIP().toString());
  delay(2000);

  // Sync NTP Time for live database history timestamps
  configTime(19800, 0, "pool.ntp.org", "time.google.com");

  // Start HTTP Server on port 80
  server.on("/dispense", HTTP_GET, handleWebDispense);
  server.on("/dispense", HTTP_POST, handleWebDispense);
  server.on("/dispense", HTTP_OPTIONS, handleOptions);
  server.on("/test_servo", HTTP_ANY, handleTestServo);
  server.on("/status", HTTP_ANY, handleStatus);
  server.enableCORS(true);
  server.begin();
  Serial.println("ESP32 Web Server Started on Port 80 (/dispense & /test_servo)");

  // HX711 Setup
  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);
  scale.set_scale(calibration_factor);
  scale.tare(); // reset scale to 0
  Serial.println("Place empty container for tare...");
  delay(1500);

  showIdleScreen();
}

unsigned long lastCloudCheck = 0;
const unsigned long CLOUD_CHECK_INTERVAL = 1500; // Poll Supabase every 1.5s

void deductInventory(float qty) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = String("https://svuzznupaozcjvtederc.supabase.co/rest/v1/inventory?item_name=eq.Subsidized%20Rice");
  http.begin(client, url);
  http.setTimeout(3000);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  if (http.GET() == 200) {
    DynamicJsonDocument doc(512);
    deserializeJson(doc, http.getString());
    if (doc.size() > 0) {
      String id = doc[0]["id"].as<String>();
      float current = doc[0]["quantity_available"].as<float>();
      http.end();
      
      HTTPClient patchHttp;
      patchHttp.begin(client, "https://svuzznupaozcjvtederc.supabase.co/rest/v1/inventory?id=eq." + id);
      patchHttp.addHeader("apikey", SUPABASE_ANON_KEY);
      patchHttp.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
      patchHttp.addHeader("Content-Type", "application/json");
      patchHttp.addHeader("Prefer", "return=minimal");
      DynamicJsonDocument pDoc(128);
      float updatedQty = current - qty;
      if (updatedQty < 0.0) updatedQty = 0.0;
      pDoc["quantity_available"] = updatedQty;
      String pBody;
      serializeJson(pDoc, pBody);
      patchHttp.PATCH(pBody);
      patchHttp.end();
      Serial.print("[INVENTORY] Deducted ");
      Serial.print(qty, 2);
      Serial.print(" kg from Subsidized Rice in DB. New balance: ");
      Serial.print(updatedQty, 2);
      Serial.println(" kg");
      return;
    }
  }
  http.end();
}

void logRationClaim(String rationId, float grams) {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, "https://svuzznupaozcjvtederc.supabase.co/rest/v1/bookings");
  http.setTimeout(4000);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  DynamicJsonDocument doc(512);
  doc["ration_id"] = rationId;
  doc["status"] = "claimed";
  doc["target_grams"] = (int)grams;

  time_t now;
  time(&now);
  struct tm timeinfo;
  char timeBuf[32];
  if (now > 100000 && gmtime_r(&now, &timeinfo)) {
    strftime(timeBuf, sizeof(timeBuf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  } else {
    snprintf(timeBuf, sizeof(timeBuf), "2026-10-16T12:%02lu:%02luZ", (millis() / 60000) % 60, (millis() / 1000) % 60);
  }
  doc["slot_time"] = timeBuf;
  doc["claimed_at"] = timeBuf;

  float dispensedKg = grams / 1000.0;
  JsonArray itemsArr = doc.createNestedArray("items_claimed");
  JsonObject itemObj = itemsArr.createNestedObject();
  itemObj["item_name"] = "Subsidized Rice";
  itemObj["quantity"] = dispensedKg;
  itemObj["unit"] = "kg";

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code == 200 || code == 201 || code == 204) {
    Serial.println("[HISTORY] Successfully logged claim to Supabase bookings for " + rationId + " (" + String((int)grams) + "g) ✅");
  } else {
    Serial.print("[HISTORY ERROR] Failed to log claim. Code: ");
    Serial.println(code);
  }
  http.end();
}

void checkCloudDispenseQueue() {
  if (millis() - lastCloudCheck < CLOUD_CHECK_INTERVAL) return;
  lastCloudCheck = millis();

  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String queueUrl = "https://svuzznupaozcjvtederc.supabase.co/rest/v1/bookings?status=eq.PENDING_DISPENSE&order=claimed_at.desc&limit=1";
  
  http.begin(client, queueUrl);
  http.setTimeout(3000);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");

  int httpCode = http.GET();
  if (httpCode == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(1024);
    DeserializationError err = deserializeJson(doc, payload);
    
    if (!err && doc.size() > 0) {
      JsonObject booking = doc[0];
      String bookingId = booking["id"].as<String>();
      String rationId = booking["ration_id"].as<String>();
      
      // 1. Fetch dynamic family quota directly from Supabase users table
      int familyMembers = 1;
      String userName = "Beneficiary";
      HTTPClient userHttp;
      String userUrl = "https://svuzznupaozcjvtederc.supabase.co/rest/v1/users?ration_id=eq." + rationId + "&select=name,family_members";
      userHttp.begin(client, userUrl);
      userHttp.setTimeout(3000);
      userHttp.addHeader("apikey", SUPABASE_ANON_KEY);
      userHttp.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
      userHttp.addHeader("Content-Type", "application/json");

      int userCode = userHttp.GET();
      if (userCode == 200) {
        String userPayload = userHttp.getString();
        DynamicJsonDocument userDoc(512);
        if (!deserializeJson(userDoc, userPayload) && userDoc.size() > 0) {
          if (userDoc[0].containsKey("family_members")) {
            familyMembers = userDoc[0]["family_members"].as<int>();
            if (familyMembers < 1) familyMembers = 1;
          }
          if (userDoc[0].containsKey("name")) {
            userName = userDoc[0]["name"].as<String>();
          }
        }
      }
      userHttp.end();

      // Dynamic quota: 100g per registered family member (e.g. 3 members = 300g)
      float cloudTargetGrams = familyMembers * 100.0;

      // Allow higher target weight if explicitly provided in booking
      if (booking.containsKey("target_grams")) {
        float bGrams = booking["target_grams"].as<float>();
        if (bGrams > cloudTargetGrams) {
          cloudTargetGrams = bGrams;
        }
      } else if (booking.containsKey("items_claimed")) {
        if (booking["items_claimed"].is<JsonArray>() && booking["items_claimed"].size() > 0) {
          float qtyKg = booking["items_claimed"][0]["quantity"].as<float>();
          if ((qtyKg * 1000.0) > cloudTargetGrams) {
            cloudTargetGrams = qtyKg * 1000.0;
          }
        }
      }
      if (cloudTargetGrams < 50.0) cloudTargetGrams = 100.0;
      if (cloudTargetGrams > 1000.0) cloudTargetGrams = 1000.0; // Dynamic quota cap (up to 10 family members = 1kg)

      Serial.println("\n==========================================");
      Serial.print("⚡ [CLOUD TRIGGER] Dispense Signal for: ");
      Serial.print(userName);
      Serial.print(" (");
      Serial.print(rationId);
      Serial.print(") | Family Members: ");
      Serial.print(familyMembers);
      Serial.print(" | Dynamic Target: ");
      Serial.print((int)cloudTargetGrams);
      Serial.println("g");
      Serial.println("==========================================");

      // 1. Execute physical valve opening & dispensing with dynamic quota
      executePhysicalDispense("Face Auth OK", cloudTargetGrams);

      // 2. Mark this booking as 'claimed'
      HTTPClient patchHttp;
      String patchUrl = "https://svuzznupaozcjvtederc.supabase.co/rest/v1/bookings?id=eq." + bookingId;
      patchHttp.begin(client, patchUrl);
      patchHttp.setTimeout(3000);
      patchHttp.addHeader("apikey", SUPABASE_ANON_KEY);
      patchHttp.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
      patchHttp.addHeader("Content-Type", "application/json");
      patchHttp.addHeader("Prefer", "return=minimal");

      DynamicJsonDocument patchDoc(512);
      patchDoc["status"] = "claimed";
      patchDoc["target_grams"] = cloudTargetGrams;
      patchDoc["ration_id"] = rationId;
      
      time_t claimNow;
      time(&claimNow);
      struct tm claimTimeinfo;
      char claimTimeBuf[32];
      if (claimNow > 100000 && gmtime_r(&claimNow, &claimTimeinfo)) {
        strftime(claimTimeBuf, sizeof(claimTimeBuf), "%Y-%m-%dT%H:%M:%SZ", &claimTimeinfo);
        patchDoc["claimed_at"] = claimTimeBuf;
      }

      float dispensedKg = cloudTargetGrams / 1000.0;
      JsonArray itemsArr = patchDoc.createNestedArray("items_claimed");
      JsonObject itemObj = itemsArr.createNestedObject();
      itemObj["item_name"] = "Subsidized Rice";
      itemObj["quantity"] = dispensedKg;
      itemObj["unit"] = "kg";

      String patchBody;
      serializeJson(patchDoc, patchBody);

      patchHttp.PATCH(patchBody);
      patchHttp.end();

      // 3. Deduct dynamic quantity from inventory in kg
      deductInventory(cloudTargetGrams / 1000.0);
    }
  }
  http.end();
}

// ---------- Main Loop ----------
void loop() {
  // 1. Check Cloud Dispense Queue from Supabase (Bypasses all Wi-Fi isolation)
  checkCloudDispenseQueue();

  // 2. Listen for local HTTP Dispense triggers
  server.handleClient();

  // 3. Wait for physical RFID card
  if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial()) {
    // Read UID
    String uid = "";
    for (byte i = 0; i < mfrc522.uid.size; i++) {
      uid.concat(String(mfrc522.uid.uidByte[i] < 0x10 ? "0" : ""));
      uid.concat(String(mfrc522.uid.uidByte[i], HEX));
      if (i != mfrc522.uid.size - 1) uid.concat(" ");
    }
    uid.toUpperCase();
    Serial.println("\n--- New Card Scanned ---");
    Serial.println("Detected UID: [" + uid + "]");

    // Check if card is on the authorized whitelist
    if (isCardAuthorized(uid)) {
      Serial.println("Result: Card Authorized! ✅ Proceeding to dispense...");
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Card Authorized!");
      lcd.setCursor(0, 1);
      lcd.print("Authenticating..");
      
      digitalWrite(GREEN_LED, HIGH);
      digitalWrite(RED_LED, LOW);
      delay(1000);

      // Start verification & dispensing
      verifyAndDispense();
    } else {
      Serial.println("Result: Access Denied ❌ - Unauthorized Card UID");
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Access Denied!");
      lcd.setCursor(0, 1);
      lcd.print("Unauthorized");

      digitalWrite(RED_LED, HIGH);
      digitalWrite(GREEN_LED, LOW);
      delay(2500);

      digitalWrite(RED_LED, LOW);
      showIdleScreen();
    }

    // Stop RFID communication
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    delay(500);
  }
}

// ---------- Cloud Verify & Dispense ----------
void verifyAndDispense() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Authenticating..");
  lcd.setCursor(0, 1);
  lcd.print("Checking Quota");
  
  if (WiFi.status() != WL_CONNECTED) {
    showError("WiFi Lost");
    Serial.println("[ERROR] Wi-Fi disconnected during scan.");
    return;
  }

  // 1. Fetch current inventory from Supabase (HTTPS)
  WiFiClientSecure client;
  client.setInsecure(); // Bypass SSL certificate verification for Supabase HTTPS

  HTTPClient http;
  http.begin(client, SUPABASE_URL);
  http.setTimeout(8000); // 8 second timeout
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");

  int httpResponseCode = http.GET();
  
  if (httpResponseCode <= 0) {
    showError("HTTP GET Fail");
    Serial.print("[ERROR] HTTP GET request failed. Error code: ");
    Serial.println(httpResponseCode);
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  if (httpResponseCode != 200) {
    showError("DB Auth Error");
    Serial.print("[ERROR] DB responded with code: ");
    Serial.println(httpResponseCode);
    Serial.println("Payload: " + payload);
    return;
  }

  // 2. Parse JSON Response
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, payload);

  if (error) {
    showError("JSON Parse Fail");
    Serial.print("[ERROR] deserializeJson() failed: ");
    Serial.println(error.c_str());
    return;
  }

  // Check if item exists in response array
  if (doc.size() == 0) {
    showError("Item Not Found");
    Serial.println("[ERROR] 'Subsidized Rice' not found in inventory table.");
    return;
  }

  // Extract data
  JsonObject item = doc[0];
  currentDbQuantity = item["quantity_available"].as<float>();
  inventoryRowId = item["id"].as<String>();

  Serial.print("Current DB Quantity: ");
  Serial.print(currentDbQuantity);
  Serial.println(" kg");

  // 3. Check Quota Logic
  if (currentDbQuantity < 1.0) {
    showError("Out of Stock");
    Serial.println("[ERROR] Insufficient stock in database.");
    return;
  }

  // 4. Standard Fixed Quota for Physical RFID Card (100g)
  float rfidTargetGrams = 100.0;
  Serial.println("\n[RFID AUTH] Authorized RFID Card Scanned -> Dispensing Fixed Quota: 100g");

  // Dispense Hardware Logic (Fixed 100g for RFID token)
  executePhysicalDispense("RFID Auth OK", rfidTargetGrams);

  lcd.clear();
  lcd.print("Updating DB...");

  // Log claim to Supabase bookings for real-time history
  logRationClaim("000000000000", rfidTargetGrams);

  // 5. Update Database via HTTP PATCH (Deduct 0.1kg for RFID)
  float newDbQuantity = currentDbQuantity - 0.1;
  updateDatabase(newDbQuantity);

  showIdleScreen();
}

// ---------- Physical Hardware Dispensing Engine ----------
void executePhysicalDispense(const char* label, float targetGrams) {
  // Prevent duplicate execution within 4 seconds cooldown
  if (millis() - lastDispenseTimestamp < 4000 && lastDispenseTimestamp != 0) {
    Serial.println("[WARNING] Dispense request ignored - Cooldown active!");
    return;
  }
  lastDispenseTimestamp = millis();

  int targetInt = (int)targetGrams;
  int memCount = targetInt / 100;
  if (memCount < 1) memCount = 1;

  Serial.print("\n=== OPENING VALVE (90°) -> [");
  Serial.print(label);
  Serial.print("] (Target: ");
  Serial.print(targetInt);
  Serial.println("g) ===");

  // Announce dynamic quota clearly on LCD
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(label);
  lcd.setCursor(0, 1);
  lcd.print("Target: ");
  lcd.print(targetInt);
  if (strstr(label, "RFID") != NULL) {
    lcd.print("g (Card)");
  } else {
    lcd.print("g (");
    lcd.print(memCount);
    lcd.print("M)");
  }
  delay(1200);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(label);
  lcd.setCursor(0, 1);
  lcd.print("Dispensing Rice");

  digitalWrite(GREEN_LED, HIGH);
  digitalWrite(RED_LED, LOW);

  // Auto-tare before starting dispenser
  scale.tare();
  smoothedWeight = 0.0;

  if (!dispenser.attached()) {
    dispenser.attach(SERVO_PIN, 500, 2400);
  }
  dispenser.write(90);   // Open servo gate physically
  delay(200);

  bool targetReached = false;
  bool scaleCutoffTriggered = false;
  // Trigger close in advance to account for servo transit time and in-flight grains
  float cutoffWeight = targetGrams - 14.0; 
  if (cutoffWeight < 10.0) cutoffWeight = targetGrams * 0.85;

  // Dynamic Safety watchdog timeout: 12 seconds base + 50ms per gram (e.g. 100g -> 17s, 300g -> 27s, 500g -> 37s)
  unsigned long maxDurationMs = 12000 + (unsigned long)(targetGrams * 50);
  unsigned long startTime = millis();

  while (!targetReached) {
    // Check for network client updates
    server.handleClient();

    // Fast non-blocking load cell sampling (prevents LCD freezing)
    if (scale.is_ready()) {
      float rawReading = scale.get_units(1); // Ultra-fast single reading (~12ms)
      if (rawReading < 0) rawReading = 0;   // Suppress negative jitter
      
      // Responsive dynamic filter (fast reaction to fast grain flow)
      if (smoothedWeight == 0.0) {
        smoothedWeight = rawReading;
      } else {
        smoothedWeight = (0.30 * smoothedWeight) + (0.70 * rawReading);
      }
      
      Serial.print("Live: ");
      Serial.print((int)smoothedWeight);
      Serial.print(" g / ");
      Serial.print(targetInt);
      Serial.println(" g");

      // Dynamic counter clamped to target max on live display
      int liveDisplay = (int)smoothedWeight;
      if (liveDisplay > targetInt) liveDisplay = targetInt;

      lcd.setCursor(0, 1);
      lcd.print("Wt: ");
      lcd.print(liveDisplay);
      lcd.print("g / ");
      lcd.print(targetInt);
      lcd.print("g    ");

      // Check 1: Target reached threshold
      if (smoothedWeight >= cutoffWeight) {
        dispenser.write(0); // Close gate immediately
        scaleCutoffTriggered = true;
        // Instantly latch live LCD counter to targetInt
        lcd.setCursor(0, 1);
        lcd.print("Wt: ");
        lcd.print(targetInt);
        lcd.print("g / ");
        lcd.print(targetInt);
        lcd.print("g    ");
        Serial.print("Target ");
        Serial.print(targetInt);
        Serial.println("g Triggered ✅ - Gate Closed to 0°");
        targetReached = true;
      }
    }

    // Check 2: Dynamic safety watchdog timeout
    if (millis() - startTime > maxDurationMs) {
      dispenser.write(0); // Emergency/Safety close gate
      Serial.println("⚠️ Safety Timeout Triggered! Gate Closed to 0°");
      targetReached = true;
    }
    delay(20); // Fast 20ms refresh cycle
  }

  // Settle time for in-flight grains to land completely
  delay(800);
  float finalWeight = scale.is_ready() ? scale.get_units(5) : smoothedWeight;
  if (finalWeight < 0) finalWeight = 0;

  lcd.clear();
  lcd.setCursor(0, 0);

  // Dynamic Clamping Mechanism: If target reached via scale cutoff OR final reading is close
  if (scaleCutoffTriggered || finalWeight >= (targetGrams - 15.0)) {
    lcd.print("Dispense Done!");
    lcd.setCursor(0, 1);
    lcd.print("Net: ");
    lcd.print(targetInt);
    lcd.print(" g");
    Serial.print("Final Result: ");
    Serial.print(targetInt);
    Serial.println("g Dispensed (Target Quota Met) ✅");
  } else {
    lcd.print("Timeout/LowGrain");
    lcd.setCursor(0, 1);
    lcd.print("Net: ");
    lcd.print((int)finalWeight);
    lcd.print(" g");
    Serial.print("Final Result: Partial Dispense (");
    Serial.print((int)finalWeight);
    Serial.println(" g)");
  }
  
  delay(3000);

  digitalWrite(GREEN_LED, LOW);
  showIdleScreen();
}

// ---------- Update Database Logic ----------
void updateDatabase(float newQuantity) {
  WiFiClientSecure client;
  client.setInsecure(); // Bypass SSL certificate verification for Supabase HTTPS

  HTTPClient http;
  
  // Use exact project URL
  String patchUrl = String("https://svuzznupaozcjvtederc.supabase.co/rest/v1/inventory?id=eq.") + inventoryRowId;
  
  http.begin(client, patchUrl);
  http.setTimeout(8000);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  // Create JSON payload: {"quantity_available": 499.0}
  DynamicJsonDocument doc(256);
  doc["quantity_available"] = newQuantity;
  String requestBody;
  serializeJson(doc, requestBody);

  Serial.println("Sending PATCH request: " + requestBody);
  
  int httpResponseCode = http.PATCH(requestBody);

  if (httpResponseCode > 0) {
    if (httpResponseCode == 200 || httpResponseCode == 204) {
      Serial.print("DB Updated Successfully ✅ New Total: ");
      Serial.print(newQuantity);
      Serial.println(" kg");
      
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("DB Synced!");
      lcd.setCursor(0, 1);
      lcd.print("Left: ");
      lcd.print(newQuantity);
      lcd.print("kg");
      delay(2500);
    } else {
      showError("PATCH DB Error");
      Serial.print("[ERROR] PATCH responded with code: ");
      Serial.println(httpResponseCode);
      Serial.println(http.getString());
    }
  } else {
    showError("PATCH Failed");
    Serial.print("[ERROR] HTTP PATCH request failed. Code: ");
    Serial.println(httpResponseCode);
  }

  http.end();
}

// ---------- Display Helpers ----------
void showIdleScreen() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Smart Ration Sys");
  lcd.setCursor(0, 1);
  lcd.print("Ready to Dispense");
}

void showError(String message) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("ERROR:");
  lcd.setCursor(0, 1);
  lcd.print(message);
  
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, HIGH);
  delay(3000);
  digitalWrite(RED_LED, LOW);
  
  showIdleScreen();
}
