import Medication from "../models/medicineModel.js"; // your mongoose model
import Notification from "../models/todayNotifications.js"; // new model
import Conversation from "../models/ConversationModel.js"; // conversation history
import notifier from "node-notifier";

// Global timer management to prevent duplicate notifications
const activeTimers = new Map(); // userId -> Set of timer IDs

// Clear all existing timers for a user
function clearUserTimers(userId) {
  const userTimers = activeTimers.get(userId);
  if (userTimers) {
    userTimers.forEach(timerId => {
      clearTimeout(timerId);
    });
    userTimers.clear();
    console.log(`🧹 Cleared ${userTimers.size || 0} existing timers for user ${userId}`);
  }
}




// Add timer to tracking
function addUserTimer(userId, timerId) {
  if (!activeTimers.has(userId)) {
    activeTimers.set(userId, new Set());
  }
  activeTimers.get(userId).add(timerId);
}

// Helper: convert HH:mm string to Date today
function getTimeForToday(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
}




// Helper: convert "15m" -> ms
function parseDuration(str) {
  if (!str) return 0;
  const unit = str.slice(-1);
  const value = parseInt(str);
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  return 0;
}

// WebSocket notification helper - sends to connected clients
function sendNotification(title, body, userId = null, type = 'general') {
  const notificationData = {
    title,
    message: body,
    type,
    timestamp: new Date().toISOString(),
    id: Date.now() + Math.random() // Simple unique ID
  };
  
  console.log(`[WEBSOCKET NOTIFY] ${title}: ${body}`);
  
  // Send to all connected clients or specific user
  if (global.io) {
    if (userId) {
      // Send to specific user's room
      global.io.to(`user-${userId}`).emit('notification', notificationData);
      console.log(`Notification sent to user ${userId}`);
    } else {
      // Send to all connected clients
      global.io.emit('notification', notificationData);
      console.log('Notification sent to all clients');
    }
  } else {
    console.warn('Socket.IO not available - notification not sent');
  }
}


// 🎯 PERSONALIZED NOTIFICATION GENERATOR
async function generatePersonalizedNotification(userId, medication, notificationType, doseTime) {
  try {
    console.log(`🧠 Generating personalized notification for ${medication.pillName}`);
    
    // 1️⃣ Get pill adherence stats (last 7 days)
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    

  
    const adherenceStats = medication.adherenceHistory
      .filter(record => record.date >= lastWeek)
      .reduce((stats, record) => {
        stats.total++;
        if (record.status === 'taken') stats.taken++;
        if (record.status === 'missed') stats.missed++;
        if (record.status === 'delayed') stats.delayed++;
        return stats;
      }, { total: 0, taken: 0, missed: 0, delayed: 0 });

    const adherenceRate = adherenceStats.total > 0 ? 
      Math.round((adherenceStats.taken / adherenceStats.total) * 100) : 100;



    // 2️⃣ Get recent health conversations
    const recentConversations = await Conversation.find({ 
      user: userId, 
      model: { $in: ['personal_health_model', 'medical_model'] }
    })
    .sort({ createdAt: -1 })
    .limit(5);

    // Analyze conversation themes
    const conversationInsights = analyzeConversationThemes(recentConversations);

    // 3️⃣ Get user's medication patterns
    const allMedications = await Medication.find({ userId });
    const healthProfile = analyzeHealthProfile(allMedications);

    // 4️⃣ Generate personalized message based on type
    return createPersonalizedMessage(
      notificationType, 
      medication, 
      adherenceStats, 
      adherenceRate, 
      conversationInsights, 
      healthProfile,
      doseTime
    );

  } catch (error) {
    console.error('Error generating personalized notification:', error);
    // Fallback to basic notification
    return getBasicNotification(notificationType, medication);
  }
}

// 🔍 Analyze conversation themes for insights
function analyzeConversationThemes(conversations) {
  const themes = {
    symptoms: [],
    concerns: [],
    improvements: [],
    sideEffects: [],
    mood: 'neutral'
  };

  conversations.forEach(conv => {
    const text = (conv.input + ' ' + conv.output).toLowerCase();
    
    // Detect symptoms mentioned
    if (text.includes('pain') || text.includes('ache') || text.includes('hurt')) {
      themes.symptoms.push('pain');
    }
    if (text.includes('tired') || text.includes('fatigue') || text.includes('energy')) {
      themes.symptoms.push('fatigue');
    }
    if (text.includes('nausea') || text.includes('sick') || text.includes('stomach')) {
      themes.symptoms.push('digestive');
    }
    
    // Detect mood indicators
    if (text.includes('better') || text.includes('good') || text.includes('improved')) {
      themes.mood = 'positive';
    }
    if (text.includes('worse') || text.includes('bad') || text.includes('difficult')) {
      themes.mood = 'negative';
    }
    
    // Detect side effects
    if (text.includes('side effect') || text.includes('reaction')) {
      themes.sideEffects.push('mentioned');
    }
  });

  return themes;
}

// 📊 Analyze user's overall health profile
function analyzeHealthProfile(medications) {
  const profile = {
    medicationCount: medications.length,
    commonTimes: [],
    medicationTypes: [],
    complexity: 'simple'
  };

  // Analyze common dosage times
  const timeFrequency = {};
  medications.forEach(med => {
    med.dosageTimes.forEach(dose => {
      timeFrequency[dose.time] = (timeFrequency[dose.time] || 0) + 1;
    });
  });

  profile.commonTimes = Object.keys(timeFrequency)
    .sort((a, b) => timeFrequency[b] - timeFrequency[a])
    .slice(0, 3);

  // Determine complexity
  if (medications.length > 3) profile.complexity = 'complex';
  else if (medications.length > 1) profile.complexity = 'moderate';

  return profile;
}


// 💬 Create personalized message based on all data
function createPersonalizedMessage(type, medication, adherenceStats, adherenceRate, insights, profile, doseTime) {
  const pillName = medication.pillName;
  const timeStr = new Date(doseTime).toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });


  let title, message;

  switch (type) {
    case 'before':
      title = getPersonalizedBeforeTitle(adherenceRate, insights);
      message = getPersonalizedBeforeMessage(pillName, medication, adherenceRate, insights, profile);
      break;
      
    case 'onTime':
      title = getPersonalizedOnTimeTitle(adherenceRate, insights);
      message = getPersonalizedOnTimeMessage(pillName, adherenceRate, insights, timeStr);
      break;
      
    case 'after':
      title = getPersonalizedAfterTitle(adherenceStats, insights);
      message = getPersonalizedAfterMessage(pillName, adherenceStats, insights);
      break;
      
    default:
      return getBasicNotification(type, medication);
  }

  return { title, message };
}




// 🕐 Personalized BEFORE reminder messages
function getPersonalizedBeforeTitle(adherenceRate, insights) {

  if (adherenceRate >= 90) return "⭐ You're doing great! Upcoming reminder";

  if (adherenceRate >= 70) return "🎯 Medicine reminder coming up";

  if (insights.mood === 'negative') return "💙 Gentle reminder - your health matters";
  return "⏰ Important: Medicine time approaching";
}

function getPersonalizedBeforeMessage(pillName, medication, adherenceRate, insights, profile) {
  const remindTime = medication.dosageTimes[0]?.remindBefore || "15m";
  
  // High adherence - encouraging
  if (adherenceRate >= 90) {
    const encouragement = [
      `Your ${adherenceRate}% adherence rate is excellent! ${pillName} reminder in ${remindTime}`,
      `You've been consistently taking ${pillName}. Reminder in ${remindTime} 🌟`,
      `Great job staying on track! ${pillName} coming up in ${remindTime}`
    ];
    return encouragement[Math.floor(Math.random() * encouragement.length)];
  }
  
  // Medium adherence - motivational
  if (adherenceRate >= 70) {
    return `Building healthy habits! ${pillName} reminder in ${remindTime}. You're at ${adherenceRate}% adherence 💪`;
  }
  
  // Low adherence - supportive
  if (insights.mood === 'negative' || insights.symptoms.length > 0) {
    return `Taking care of yourself is important. ${pillName} reminder in ${remindTime}. You've got this! 💙`;
  }
  
  // Complex regimen - helpful
  if (profile.complexity === 'complex') {
    return `Managing ${profile.medicationCount} medications is tough! ${pillName} reminder in ${remindTime} 🎯`;
  }
  
  return `${pillName} reminder in ${remindTime}. Every dose counts toward your health goals! 🌱`;
}

// 💊 Personalized ON-TIME reminder messages  
function getPersonalizedOnTimeTitle(adherenceRate, insights) {
  if (adherenceRate >= 90) return "💊 Time for your medicine, champion!";
  if (insights.symptoms.includes('pain')) return "💊 Pain relief time - your medicine is ready";
  if (insights.mood === 'positive') return "💊 Medicine time - keep that positive momentum!";
  return "💊 It's medicine time";
}

function getPersonalizedOnTimeMessage(pillName, adherenceRate, insights, timeStr) {
  // Symptom-specific messages
  if (insights.symptoms.includes('pain')) {
    return `Time for ${pillName} - this should help with your pain management 🩹`;
  }
  if (insights.symptoms.includes('fatigue')) {
    return `${pillName} time! This may help with your energy levels ⚡`;
  }
  
  // Mood-based messages
  if (insights.mood === 'positive') {
    return `${pillName} at ${timeStr}. Love how you're taking charge of your health! ✨`;
  }
  if (insights.mood === 'negative') {
    return `${pillName} time. Small steps, big progress. You're worth the care 💙`;
  }
  
  // Adherence-based messages
  if (adherenceRate >= 90) {
    return `${pillName} at ${timeStr}. Your consistency is inspiring! 🌟`;
  }
  if (adherenceRate >= 70) {
    return `${pillName} at ${timeStr}. Building those healthy habits! 💪`;
  }
  
  return `Time for ${pillName} at ${timeStr}. Your health journey matters! 🌱`;
}

// ❗ Personalized AFTER (missed dose) messages
function getPersonalizedAfterTitle(adherenceStats, insights) {
  if (adherenceStats.missed > 2) return "❗ Multiple missed doses - let's get back on track";
  if (insights.mood === 'negative') return "💙 Gentle check-in about your medicine";
  return "❗ Did you miss your medicine?";
}

function getPersonalizedAfterMessage(pillName, adherenceStats, insights) {
  // Multiple misses - supportive intervention
  if (adherenceStats.missed > 2) {
    return `${pillName} - I notice you've missed a few doses lately. Is everything okay? Your health team is here to help 💙`;
  }
  
  // Mood-sensitive messaging
  if (insights.mood === 'negative') {
    return `${pillName} - it's okay if you missed it. Tomorrow is a fresh start. Your wellbeing matters 🌱`;
  }
  
  // Encouraging recovery
  if (adherenceStats.total > 0) {
    const rate = Math.round((adherenceStats.taken / adherenceStats.total) * 100);
    return `${pillName} - you're usually good at ${rate}% adherence. Just a gentle reminder to get back on track! 🎯`;
  }
  
  return `${pillName} - did you forget? No worries, it happens! Consider setting a phone alarm for tomorrow 📱`;
}

// 🔄 Fallback basic notifications
function getBasicNotification(type, medication) {
  const basic = {
    before: {
      title: "Medicine Reminder ⏰", 
      message: `Take ${medication.pillName} soon`
    },
    onTime: {
      title: "Time to Take Medicine 💊", 
      message: `Take ${medication.pillName} now`
    },
    after: {
      title: "Missed Dose ❗", 
      message: `Did you forget ${medication.pillName}?`
    }
  };
  return basic[type] || basic.onTime;
}




// Main scheduler
export default async function startNotificationScheduler(user) {
  console.log("📅 Starting daily medication notification scheduler...");
  let userId;
if (user?.user?.id) {
  // if called from login (wrapped object)
  userId = user.user.id.toString();
} else if (user?._id) {
  // if called from signup (Mongoose document)
  userId = user._id.toString();
} else {
  console.error("Invalid user object passed to scheduler:", user);
  return; // exit if user is invalid
}

console.log("User id:", userId);

  // 🧹 Clear any existing timers for this user to prevent duplicates
  clearUserTimers(userId);
  console.log(`🔄 Restarting scheduler for user ${userId} - existing timers cleared`);

  try {
    const today = new Date();
    const todayDay = today.toLocaleString("en-US", { weekday: "long" }); // e.g., "Monday"
    const todayDate = today.toISOString().split("T")[0]; // e.g., "2025-10-04"
    console.log("Today is:", todayDay);

    // Fetch medicines for the user and for today
    const todaysMeds = await Medication.find({
      userId: userId,
      dosageDays: { $in: [todayDay] },
    });

    console.log("todays med", todaysMeds);

    // Sort by time ascending
    todaysMeds.sort((a, b) => {
      const timeA = getTimeForToday(a.dosageTimes[0].time); // assuming first time for simplicity
      const timeB = getTimeForToday(b.dosageTimes[0].time);
      return timeA - timeB;
    });


  
    // Schedule notifications for each medicine
    todaysMeds.forEach((med) => {
      med.dosageTimes.forEach(async (dose) => {
        const medTime = getTimeForToday(dose.time);

        // BEFORE reminder
        const beforeMs = medTime.getTime() - parseDuration(dose.remindBefore);
        if (beforeMs > Date.now()) {
          const timerId = setTimeout(async () => {
            // 🎯 Generate personalized notification
            const personalizedNotif = await generatePersonalizedNotification(
              userId, med, 'before', medTime
            );
            
            sendNotification(
              personalizedNotif.title,
              personalizedNotif.message,
              userId,
              "before"
            );
          }, beforeMs - Date.now());

          // 💾 Save to DB with personalized message
          const personalizedNotif = await generatePersonalizedNotification(
            userId, med, 'before', medTime
          );
          
          await Notification.findOneAndUpdate(
            { userId, date: todayDate },
            {
              $setOnInsert: { dayName: todayDay },
              $push: {
                notifications: {
                  title: personalizedNotif.title,
                  message: personalizedNotif.message,
                  type: "before",
                  medicineId: med._id,
                  medicineName: med.pillName,
                  time: new Date(beforeMs),
                },
              },
            },
            { upsert: true, new: true }
          );
          
          // Track the timer
          addUserTimer(userId, timerId);
          console.log(`⏰ Scheduled PERSONALIZED BEFORE reminder for ${med.pillName} at ${new Date(beforeMs).toLocaleTimeString()}`);
        }



  
        // ON-TIME reminder
        if (medTime.getTime() > Date.now()) {
          const timerId = setTimeout(async () => {
            // 🎯 Generate personalized notification
            const personalizedNotif = await generatePersonalizedNotification(
              userId, med, 'onTime', medTime
            );
            
            sendNotification(
              personalizedNotif.title,
              personalizedNotif.message,
              userId,
              "onTime"
            );
          }, medTime.getTime() - Date.now());

          // 💾 Save to DB with personalized message
          const personalizedNotif = await generatePersonalizedNotification(
            userId, med, 'onTime', medTime
          );

          await Notification.findOneAndUpdate(
            { userId, date: todayDate },
            {
              $setOnInsert: { dayName: todayDay },
              $push: {
                notifications: {
                  title: personalizedNotif.title,
                  message: personalizedNotif.message,
                  type: "onTime",
                  medicineId: med._id,
                  medicineName: med.pillName,
                  time: medTime,
                },
              },
            },
            { upsert: true, new: true }
          );
          
          // Track the timer
          addUserTimer(userId, timerId);
          console.log(`💊 Scheduled PERSONALIZED ON-TIME reminder for ${med.pillName} at ${medTime.toLocaleTimeString()}`);
        }

        // AFTER reminder
        const afterMs = medTime.getTime() + parseDuration(dose.remindAfter);
        if (afterMs > Date.now()) {
          const timerId = setTimeout(async () => {
            // 🎯 Generate personalized notification
            const personalizedNotif = await generatePersonalizedNotification(
              userId, med, 'after', medTime
            );
            
            sendNotification(
              personalizedNotif.title,
              personalizedNotif.message,
              userId,
              "after"
            );
          }, afterMs - Date.now());

          // 💾 Save to DB with personalized message
          const personalizedNotif = await generatePersonalizedNotification(
            userId, med, 'after', medTime
          );

          await Notification.findOneAndUpdate(
            { userId, date: todayDate },
            {
              $setOnInsert: { dayName: todayDay },
              $push: {
                notifications: {
                  title: personalizedNotif.title,
                  message: personalizedNotif.message,
                  type: "after",
                  medicineId: med._id,
                  medicineName: med.pillName,
                  time: new Date(afterMs),
                },
              },
            },
            { upsert: true, new: true }
          );
          
          // Track the timer
          addUserTimer(userId, timerId);
          console.log(`❗ Scheduled PERSONALIZED AFTER reminder for ${med.pillName} at ${new Date(afterMs).toLocaleTimeString()}`);
        }
      });
    });

    // 🔹 Dummy test notification after 10 seconds
    const testTimerId = setTimeout(async () => {
      sendNotification("🔔 Test Notification", "This is a dummy test alert!", userId, "test");

      await Notification.findOneAndUpdate(
        { userId, date: todayDate },
        {
          $setOnInsert: { dayName: todayDay },
          $push: {
            notifications: {
              title: "🔔 Test Notification",
              message: "This is a dummy test alert!",
              type: "test",
              time: new Date(),
            },
          },
        },
        { upsert: true, new: true }
      );
    }, 10 * 1000);
    
    // Track the test timer
    addUserTimer(userId, testTimerId);
    console.log(`🧪 Scheduled TEST notification in 10 seconds`);

    // Summary log
    const userTimers = activeTimers.get(userId);
    console.log(`✅ Total ${userTimers ? userTimers.size : 0} notifications scheduled for user ${userId}`);

  } catch (err) {
    console.error("Error scheduling notifications:", err);
  }
}

// Retrieve today's notification messages for a given userId
export async function getTodaysNotifications(userOrId) {
  try {
    // normalize input to userId string
    let userId = null;
    if (!userOrId) return [];
    if (typeof userOrId === 'string') userId = userOrId;
    else if (userOrId.id) userId = String(userOrId.id);
    else if (userOrId.user && userOrId.user.id) userId = String(userOrId.user.id);
    if (!userId) return [];

    const today = new Date();
    const todayDate = today.toISOString().split('T')[0];

    const doc = await Notification.findOne({ userId, date: todayDate }).lean();
    if (!doc) return [];
    // return the notifications array (each has title, message, time, etc.)
    return doc.notifications || [];
  } catch (err) {
    console.error('Error in getTodaysNotifications:', err);
    return [];
  }
}

// Express handler: expects { localuser } or { userId } in req.body
export async function getTodaysNotificationsHandler(req, res) {
  try {
    console.log('getTodaysNotificationsHandler body:', JSON.stringify(req.body));
    const { localuser, userId } = req.body || {};
    const data = await getTodaysNotifications(localuser || userId);
    return res.status(200).json({ success: true, message: 'Today notifications fetched', data });
  } catch (err) {
    console.error('Error in getTodaysNotificationsHandler:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
}
