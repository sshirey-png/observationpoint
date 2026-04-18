/**
 * Get Better Faster Action Steps — coaching playbook by Paul Bambrick-Santoyo.
 * Organized by rubric dimension. Each step has:
 *   cat — category (e.g., "Routines & Procedures")
 *   action — what to do
 *   when — when to use this step
 *   prompt — coaching question to ask the teacher
 *   rtc — real-time coaching cue for next visit
 */

export const ACTION_STEPS = {
  T1: [
    {cat:'Routines & Procedures',action:'Plan critical routines and procedures moment-by-moment',when:'Teacher does not have clear routines established',prompt:'"What is each step the teacher takes in this routine? What is the teacher doing and what are the students doing?"',rtc:'N/A'},
    {cat:'Routines & Procedures',action:'Plan the roll-out for introducing the routine',when:'Routine is new for the students',prompt:'"What will be the most difficult parts for students to master? How will you model this effectively?"',rtc:'If model is ineffective: "Am I following your model effectively?"'},
    {cat:'Routines & Procedures',action:'Do It Again & Cut It Short',when:"Students aren't performing a routine correctly",prompt:'"What are the keys to running a Do It Again effectively?"',rtc:'Non-verbal: Make a circle with your finger to cue Do It Again'},
    {cat:'Strong Voice',action:'Square up and stand still',when:"Teacher's body language lacks leadership presence",prompt:'"What is the value in communicating leadership with our body language?"',rtc:'Non-verbal: shift body upward and arch shoulders'},
    {cat:'Strong Voice',action:'Use formal register',when:"Teacher's tone lacks leadership presence",prompt:'"Imagine saying \'It\'s time to leave\' to three audiences. What\'s the value of the middle one?"',rtc:'Non-verbal: square up gesture + point to mouth'},
    {cat:'Clear Directions',action:'Use MVP Directions',when:"Teacher's directions are unclear and use too many words",prompt:'"What happened when you asked students to ___? What caused the dip in behavior?"',rtc:'Non-verbal: sign MVP. Whisper: "When I say go, at a level zero..."'},
    {cat:'Teacher Radar',action:'Perch and Be Seen Looking',when:"Students don't feel teacher is monitoring",prompt:'"How do the students know you are monitoring their behavior?"',rtc:'Non-verbal: Make gesture of Be Seen Looking'},
    {cat:'Teacher Radar',action:'Scan Hot Spots',when:'Teacher is not noticing earliest non-compliance',prompt:'"At what moment do the first students begin to go off track? Which students are most often off task?"',rtc:'Hold hand out over a hot spot'},
    {cat:'Teacher Radar',action:'Circulate the perimeter',when:'Teacher is stationary',prompt:'"Where did the off-task behavior start? Where were you standing?"',rtc:'Non-verbal: point to a corner where they should stand'},
    {cat:'Pacing',action:'Time Yourself',when:"Lesson doesn't conform to time stamps",prompt:'"How much time did you want to spend on the I Do? What kept us from sticking?"',rtc:'Non-verbal: point at watch. Hand signal for minutes remaining'},
    {cat:'Pacing',action:'Illusion of Speed',when:"Students don't have urgency",prompt:'"How could you challenge students to work with greater purpose?"',rtc:'Non-verbal: 5-4-3-2-1 with fingers'},
    {cat:'Narrate the Positive',action:'Use a warm/strict voice',when:'Tone when addressing management is overly negative',prompt:'"How did the teacher get students to correct misbehaviors without being negative?"',rtc:'Non-verbal: index card with plus sign. Whisper: "Warm strict"'},
    {cat:'Narrate the Positive',action:'Narrate the Positive X3',when:"Off-task students don't respond to clear directions",prompt:'"What does this teacher do after giving clear directions? How does that affect attention?"',rtc:'Whisper: "Narrate X3"'},
    {cat:'Individual Correction',action:'Least-Invasive Intervention',when:'Corrections draw more attention than necessary',prompt:'"What is the advantage of starting with the least invasive intervention?"',rtc:'Non-verbal: point to off-task students. Whisper: "Use ___ intervention"'},
    {cat:'Consequence',action:'Give a consequence',when:'Consequences are not being implemented',prompt:'"You gave clear directions, narrated X3, did non-verbal cues but students still off task. What could you do?"',rtc:'Non-verbal or whisper to implement consequence'},
  ],
  T2: [
    {cat:'Kind Words & Empathy',action:'Explicitly teach words and actions of politeness',when:'Students are not using polite words',prompt:'"What words would you like students to use when interacting?"',rtc:'Non-verbal: Point to the poster'},
    {cat:'Kind Words & Empathy',action:'Explicitly teach words and actions of apology',when:'Students are not apologizing',prompt:'"What words would you like students to use when they need to apologize?"',rtc:'Non-verbal: Point to the poster'},
    {cat:'Kind Words & Empathy',action:'Teach response to consequences from teacher',when:'Students have unproductive arguments with teacher',prompt:'"When students have a conflict with you, how do you want them to respond?"',rtc:'Model: Remind student when they don\'t adhere'},
    {cat:'Kind Words & Empathy',action:'Teach conflict resolution between students',when:'Students have unproductive arguments with each other',prompt:'"When students have a conflict, how do you want them to respond?"',rtc:'Model: Remind student when they don\'t adhere'},
    {cat:'Kagan Strategies',action:'Model the routine for each new structure',when:'Students are confused during a structure',prompt:'"Watch me model the rollout. What did I do and say?"',rtc:'Model: Rollout of a Kagan structure for the teacher'},
    {cat:'Kagan Strategies',action:'Implement class-building activities',when:'Teacher is not implementing class-building',prompt:'"What is the goal of class-building? What is holding you back?"',rtc:'N/A'},
    {cat:'Kagan Strategies',action:'Use gambits at end of structures',when:"Teacher doesn't prompt kind words to partner",prompt:'"What is the purpose of using a gambit at the end of a Kagan structure?"',rtc:'Non-verbal: Point to gambit poster. Whisper: "Use your gambits!"'},
  ],
  T3: [
    {cat:'Lesson Internalization',action:'Script exemplar Exit Ticket response',when:'Teacher struggles to identify mastery',prompt:'"What do you want students to write on the exit ticket? What exactly?"',rtc:'N/A'},
    {cat:'Lesson Internalization',action:'ID key points and must-dos',when:'Teacher does not address key points',prompt:'"What are the most important must-do parts for this lesson?"',rtc:'Whisper: "How does this connect to our key point of ___?"'},
    {cat:'Lesson Internalization',action:'Script exemplar answers (Right is Right)',when:'Teacher struggles to evaluate responses in-the-moment',prompt:'"What is the completely right answer? What answers would be only partially correct?"',rtc:'N/A'},
    {cat:'Lesson Internalization',action:'Plan engagement strategies',when:'Teacher does not plan for specific pedagogical moves',prompt:'"What are the specific ways you want students engaged?"',rtc:'Whisper: Prompt for using an engagement strategy'},
    {cat:'Lesson Internalization',action:'Plan accommodations/supplements',when:'Teacher does not plan specific accommodations',prompt:'"What are the specific accommodations and modifications?"',rtc:'Whisper: Prompt for using a specific acc/mod'},
    {cat:'Lesson Internalization',action:'Key moments to address misconceptions',when:'Teacher struggles to check understanding',prompt:'"What key part did students not understand? Why? What was the misconception?"',rtc:'N/A'},
  ],
  T4: [
    {cat:'Independent Practice',action:'Plan moments for Everybody Writes',when:'Students lack opportunities to write before discussing',prompt:'"What are the limitations of discussion for assessing every student?"',rtc:'Non-verbal: write in the air. Intervene: "Everybody write: [key question]"'},
    {cat:'Engaging All Students',action:'Call on all students',when:'Teacher tends to call on same few students',prompt:'"Let\'s look at footage — which students are you calling on? Which aren\'t?"',rtc:'Non-verbal: point to ideal student to call on'},
    {cat:'Engaging All Students',action:'Rule of Thirds (cold call, taking hands, choral response)',when:'Teacher over-relies on one technique',prompt:'"When is the best moment to use cold call vs. taking hands vs. choral response?"',rtc:'Non-verbal: cue for cold call, choral response, all hands'},
  ],
  T5: [
    {cat:'Active Monitoring',action:'ActMo 1 — Monitoring pathway for On Task Start',when:"Teacher isn't checking if students are starting work",prompt:'"What is the purpose of monitoring? Which 2-3 students do you approach first?"',rtc:'Cue teacher to monitor lap for On Task Start'},
    {cat:'Active Monitoring',action:'ActMo 2 — Monitor quality of student work',when:'Teacher does not see patterns in answers',prompt:'"What is the purpose of active monitoring during work time?"',rtc:'Whisper: Share patterns you\'re seeing in responses'},
    {cat:'Active Monitoring',action:'ActMo 3 — Mark up student work and give feedback',when:'Few students getting explicit feedback',prompt:'"What is the student experiencing when you\'re monitoring? How many know if they\'re on track?"',rtc:'Whisper: Prompt lap for feedback. Model.'},
    {cat:'Active Monitoring',action:'ActMo 4 — Ensure students apply feedback',when:'Few students using feedback to adjust work',prompt:'"Once you\'ve written feedback, how do you know they\'ve made an adjustment?"',rtc:'Whisper: Prompt lap for response to feedback'},
    {cat:'Check for Understanding',action:'Poll the Room',when:'Teacher moves ahead without knowing who comprehends',prompt:'"What is the purpose of polling the room? When would be the best moments?"',rtc:'Intervene: Poll the room'},
    {cat:'Check for Understanding',action:'Data-Driven Cold Call',when:"Teacher doesn't call on students who most need practice",prompt:'"Which students are ideal to call on for each question?"',rtc:'Whisper: "Call on a [high/medium/low] student"'},
    {cat:'DDI',action:'Roll back the answer',when:"Students aren't given a chance to correct errors",prompt:'"What do you want students to say? Where will they struggle?"',rtc:'Non-verbal: rolling/cranking motion'},
    {cat:'DDI',action:'Break it down / content-specific prompts',when:'After incorrect response, teacher moves on or repeats question',prompt:'"What are the key components the student must know to answer correctly?"',rtc:'Signal when best move is to break it down. Model if needed.'},
    {cat:'DDI',action:'Close the loop',when:"After incorrect answer, teacher doesn't return to student",prompt:'"When the student gave the incorrect answer, what was the missed opportunity?"',rtc:'Whisper: "Come back to x student to make sure they understand"'},
  ],
}
