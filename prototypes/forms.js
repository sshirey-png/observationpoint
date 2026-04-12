/**
 * ObservationPoint — Form Definitions
 * All form types, rubric dimensions, shared sections, and scales.
 * Data-driven form engine renders UI from these configs.
 */

// =============================================
// SCALES
// =============================================
var SCALE_1_5 = {
    min: 1, max: 5,
    labels: {1:'NI', 2:'Emrg', 3:'Dev', 4:'Prof', 5:'Exm'},
    fullLabels: {1:'Needs Improvement', 2:'Emerging', 3:'Developing', 4:'Proficient', 5:'Exemplary'}
};
var COLORS_1_5 = {1:'#ef4444', 2:'#f97316', 3:'#eab308', 4:'#22c55e', 5:'#0ea5e9'};

var SCALE_1_7 = {
    min: 1, max: 7,
    labels: {1:'1', 2:'2', 3:'3', 4:'4', 5:'5', 6:'6', 7:'7'},
    ranges: {low:{min:1,max:2,label:'Low'}, mid:{min:3,max:5,label:'Mid'}, high:{min:6,max:7,label:'High'}}
};
var COLORS_1_7 = {1:'#ef4444', 2:'#ef4444', 3:'#eab308', 4:'#eab308', 5:'#eab308', 6:'#22c55e', 7:'#22c55e'};

var SCALE_TRACK = {min: 1, max: 2, labels: {1:'Off Track', 2:'On Track'}};
var COLORS_TRACK = {1:'#ef4444', 2:'#22c55e'};

// =============================================
// RUBRIC DIMENSIONS (reusable across form types)
// =============================================
var TEACHER_DIMS = [
    {code:'T1', name:'On Task',
     q:'Are all students engaged in the work of the lesson from start to finish?',
     required: true,
     desc: {
         1:'Very few students complete tasks or follow expectations. Routines not orderly. Students left without work.',
         2:'Some students complete tasks. Transitions only sometimes orderly. Students idle 1-2 minutes at a time.',
         3:'Most students complete tasks and follow expectations. Transitions mostly orderly. Students idle for short periods (<1 min).',
         4:'All or almost all students complete tasks and follow expectations. Transitions orderly with minimal direction. Quick pace start to finish.',
         5:'Level 4 met, plus: Students assume responsibility for routines self-directed. Students hold each other accountable.'
     }},
    {code:'T2', name:'Community of Learners',
     q:'Are all students active members of a joyful and supportive classroom community?',
     desc: {
         4:'All students use kind words & show empathy. All respond to consequences calmly. Positive, student-driven interactions. Kagan activities always incorporated with gambits.'
     }},
    {code:'T3', name:'Essential Content',
     q:'Are all students working with content aligned to the appropriate standards for their subject and grade?',
     desc: {
         4:'All activities aligned, well-sequenced, build on each other. All materials high-quality and appropriately demanding. All lessons drive towards meaning-driven question.'
     }},
    {code:'T4', name:'Cognitive Engagement',
     q:'Are all students responsible for doing the thinking in this classroom?',
     desc: {
         4:'All students provide meaningful evidence to support thinking. Students respond to and build on peers\' ideas. Engaged in discussion/writing >50% of lesson.'
     }},
    {code:'T5', name:'Demonstration of Learning',
     q:'Do all students demonstrate that they are learning?',
     desc: {
         4:'Assessments pinpoint where understanding breaks down. Extensive opportunities for academic writing. All students on track to achieve learning goals.'
     }},
];

var PREK_DIMS = [
    {code:'PK1',  name:'Positive Climate',                    abbr:'PC',  domain:'Emotional Support',        required:true},
    {code:'PK2',  name:'Negative Climate',                    abbr:'NC',  domain:'Emotional Support',        required:true},
    {code:'PK3',  name:'Teacher Sensitivity',                 abbr:'TS',  domain:'Emotional Support',        required:true},
    {code:'PK4',  name:'Regard for Student Perspectives',     abbr:'RSP', domain:'Classroom Organization',   required:true},
    {code:'PK5',  name:'Behavior Management',                 abbr:'BM',  domain:'Classroom Organization',   required:true},
    {code:'PK6',  name:'Productivity',                        abbr:'PD',  domain:'Classroom Organization',   required:true},
    {code:'PK7',  name:'Instructional Learning Formats',      abbr:'ILF', domain:'Classroom Organization',   required:true},
    {code:'PK8',  name:'Concept Development',                 abbr:'CD',  domain:'Instructional Support',    required:true},
    {code:'PK9',  name:'Quality of Feedback',                 abbr:'QF',  domain:'Instructional Support',    required:true},
    {code:'PK10', name:'Language Modeling',                    abbr:'LM',  domain:'Instructional Support',    required:true},
];

var LEADER_DIMS = [
    {code:'L1', name:'Instructional Leadership',
     q:'Does the leader ensure all classes within their scope meet or exceed the FLS Vision of Excellence and lead to increased academic achievement?', required:true},
    {code:'L2', name:'Cultural Leadership and Builder',
     q:'Does the leader build a motivational school culture that holds high behavioral and academic expectations for all?', required:true},
    {code:'L3', name:'Personal Leadership and Builder',
     q:'Does the leader inspire and motivate all staff, students and parents to consistently model the key mindsets and Commitments?', required:true},
    {code:'L4', name:'Talent Management',
     q:'Does the leader ensure they plan for, cultivate, hire, develop and manage team members who value both results and relationships?', required:true},
    {code:'L5', name:'Strategic and Operations Leadership',
     q:'Does the leader ensure that resources (structures, time, money, partnerships) are allocated effectively?', required:true},
];

var FUNDAMENTALS_DIMS = [
    {code:'M1', name:'On Task Minute 1', type:'percent', required:true},
    {code:'M2', name:'On Task Minute 2', type:'percent', required:true},
    {code:'M3', name:'On Task Minute 3', type:'percent', required:true},
    {code:'M4', name:'On Task Minute 4', type:'percent', required:true},
    {code:'M5', name:'On Task Minute 5', type:'percent', required:true},
    {code:'OP', name:'On Pace?',                          type:'binary', required:false},
    {code:'FL', name:'Fundamentals Locked?',              type:'binary', required:true,
     q:'Is Fundamentals locked in for this teacher?'},
    {code:'RB', name:'Relationship Building',             type:'binary', required:true,
     q:'Are the foundations for Relationship Building/Community of Learners in place?'},
];

// =============================================
// SHARED SECTIONS (composable across PMAPs and Self-Reflections)
// =============================================
var SHARED_SECTIONS = {
    meeting_checklist: {
        title: 'Meeting Checklist',
        fields: [
            {id:'job_desc_reviewed', label:'Has the job description been reviewed?', type:'select', required:true, options:['Yes','No']},
        ]
    },
    wig_goals: {
        title: 'Wildly Important Goal (WIG) + Annual Goals Review',
        fields: [
            {id:'wig_goals_text', label:'WIG + Annual Goals', type:'richtext', required:true,
             placeholder:'Refer to the goals. Note any updates or changes, or write "N/A" if unchanged.'},
            {id:'wig_status',  label:'Wildly Important Goal (WIG)', type:'track', required:true},
            {id:'ag1_status',  label:'Annual Goal 1 (AG1)',         type:'track'},
            {id:'ag2_status',  label:'Annual Goal 2 (AG2)',         type:'track'},
            {id:'ag3_status',  label:'Annual Goal 3 (AG3)',         type:'track'},
            {id:'progress_notes', label:'Progress Toward Goal', type:'richtext',
             placeholder:'Please provide data to support your ratings above. You may also provide additional context/evidence.'},
        ]
    },
    whirlwind: {
        title: 'Whirlwind Work Review (Other Workstreams)',
        subtitle: 'Other responsibilities not defined by your WIG or Annual Goals.',
        fields: [
            {id:'whirlwind_list', label:'Whirlwind Workstream List', type:'richtext',
             placeholder:'List the 3-5 most important aspects of whirlwind work and how those responsibilities are handled effectively.'},
        ]
    },
    rubric_review_teacher: {
        title: 'FLS Teacher Rubric',
        subtitle: 'Provide input on strength and growth areas based on the FLS Teacher rubric.',
        fields: [
            {id:'rubric_strength', label:'Strength Areas', type:'richtext', required:true,
             placeholder:'Identify strengths and provide rationale'},
            {id:'rubric_growth',   label:'Growth Areas',   type:'richtext', required:true,
             placeholder:'Identify areas for growth and provide rationale'},
        ]
    },
    rubric_review_prek: {
        title: 'FLS PreK Class Rubric',
        fields: [
            {id:'prek_strength', label:'Strength Areas', type:'richtext', required:true,
             placeholder:'Identify strengths and provide supporting rationale'},
            {id:'prek_growth',   label:'Growth Areas',   type:'richtext', required:true,
             placeholder:'Identify growth areas and provide supporting rationale'},
        ]
    },
    personal_leadership: {
        title: 'FLS Personal Leadership',
        fields: [
            {id:'pl_strength', label:'Personal Leadership Strength',     type:'richtext', required:true,
             placeholder:'Identify strengths and provide supporting rationale'},
            {id:'pl_growth',   label:'Personal Leadership Growth Area',  type:'richtext', required:true,
             placeholder:'Identify growth areas and provide supporting rationale'},
        ]
    },
    commitments: {
        title: 'FLS Commitments',
        fields: [
            {id:'commitment_strength', label:'FLS Commitment Strength',     type:'richtext', required:true,
             placeholder:'Identify strengths and provide supporting rationale.'},
            {id:'commitment_growth',   label:'FLS Commitment Growth Area',  type:'richtext', required:true,
             placeholder:'Identify growth areas and provide supporting rationale.'},
        ]
    },
    career: {
        title: 'Professional Development & Career Growth',
        fields: [
            {id:'career_goals',    label:'Career Goals', type:'richtext', required:true,
             placeholder:'Reflect on long-term career goals. Identify skills, experiences, or opportunities that would help close the gap between current state and future aspirations.'},
            {id:'licenses_certs',  label:'Licenses, Certifications, and Trainings', type:'richtext', required:true,
             placeholder:'Discuss progress towards required licenses, certifications, and trainings (i.e. Science of Reading, teacher certification, etc.) Write N/A if not applicable.'},
        ]
    },
    concerns: {
        title: 'Area(s) of Concern',
        subtitle: 'Indicate if there is an issue that could lead to an IAP or corrective action up to termination of employment.',
        fields: [
            {id:'concern_areas',    label:'Area(s) of Concern', type:'checkbox_group',
             options:['Professionalism', 'Performance', 'Commitment', 'None']},
            {id:'concern_comments', label:'Area of Concern Comments', type:'richtext', required:true,
             placeholder:'Provide any additional notes or context around areas of concern. Include any action steps and non-negotiable indicators of success.'},
        ]
    },
};

// =============================================
// FORM DEFINITIONS
// =============================================
var FORMS = {

    // ---- TOUCHPOINTS ----

    teacher: {
        id:'fls_teacher_v1', name:'Teacher Observation', category:'touchpoint',
        badge:'Teacher Obs', badgeColor:'#dbeafe', badgeText:'#2563eb',
        scale:SCALE_1_5, colors:COLORS_1_5,
        hasCycles:false, hasRecording:true,
        dimensions: TEACHER_DIMS,
        feedback: [
            {id:'see_it_success',  label:'See It / Name It: Success',       placeholder:'What\'s working well in this classroom?'},
            {id:'see_it_growth',   label:'See It / Name It: Area(s) of Growth', placeholder:'Where is there opportunity to grow?'},
            {id:'do_it_practice',  label:'Do It: What did you practice?',   placeholder:'What was practiced during the debrief?'},
        ]
    },

    prek: {
        id:'fls_prek_class_v1', name:'PreK Observation (CLASS)', category:'touchpoint',
        badge:'CLASS PreK', badgeColor:'#fce7f3', badgeText:'#db2777',
        scale:SCALE_1_7, colors:COLORS_1_7,
        hasCycles:true, hasRecording:true,
        dimensions: PREK_DIMS,
        feedback: [{id:'observation_note', label:'Observation Note', placeholder:'Provide additional details or context'}]
    },

    fundamentals: {
        id:'fls_fundamentals_v1', name:'Fundamentals', category:'touchpoint',
        badge:'Fundamentals', badgeColor:'#fef3c7', badgeText:'#ca8a04',
        scale:{min:0, max:100}, colors:{0:'#ef4444', 100:'#22c55e'},
        hasCycles:false, hasRecording:true,
        dimensions: FUNDAMENTALS_DIMS,
        feedback: [{id:'fundamental_skills', label:'Fundamental Skills', placeholder:'Identify the Fundamental skills to be addressed'}]
    },

    meeting_o3: {
        id:'meeting_o3', name:'O3 / Coaching Meeting', category:'touchpoint',
        badge:'Meeting', badgeColor:'#f0fdf4', badgeText:'#16a34a',
        scale:null, colors:null,
        hasCycles:false, hasRecording:false,
        dimensions: [],
        feedback: [
            {id:'discussion',  label:'What was discussed?', placeholder:'Meeting discussion notes...'},
            {id:'next_steps',  label:'Next Steps',          placeholder:'Action items and follow-ups...'},
        ]
    },

    meeting_data_relay: {
        id:'meeting_data_relay', name:'Data Meeting (Relay)', category:'touchpoint',
        badge:'Data Meeting', badgeColor:'#f0fdf4', badgeText:'#16a34a',
        scale:null, colors:null,
        hasCycles:false, hasRecording:false,
        dimensions: [],
        feedback: [
            {id:'standard',            label:'Standard',                          placeholder:'Text'},
            {id:'initial_mastery',     label:'Initial Mastery',                   placeholder:'Number', type:'number'},
            {id:'know_show_summary',   label:'Know/Show Summary',                 placeholder:'Summary of student understanding...'},
            {id:'see_it_success',      label:'See It / Name It: Success',         placeholder:'What\'s working?'},
            {id:'see_it_growth',       label:'See It / Name It: Area of Growth',  placeholder:'Where is the gap?'},
            {id:'do_it_reteach_plan',  label:'Do It: Reteach Plan',               placeholder:'Plan for reteaching...'},
            {id:'do_it_reteach_prep',  label:'Do It: Reteach Prep',               placeholder:'Preparation for reteach...'},
            {id:'reteach_date',        label:'Reteach Date',                      type:'date'},
            {id:'reteach_mastery',     label:'Reteach Mastery',                   placeholder:'Number', type:'number'},
            {id:'reteach_reflection',  label:'Reteach Reflection',                placeholder:'Reflection on reteach outcomes...'},
            {id:'notes',               label:'Notes',                             placeholder:'Additional notes...'},
        ]
    },

    quick_feedback: {
        id:'quick_feedback', name:'Quick Feedback', category:'touchpoint',
        badge:'Quick Feedback', badgeColor:'#fef3c7', badgeText:'#ca8a04',
        scale:null, colors:null,
        hasCycles:false, hasRecording:false,
        dimensions: [],
        feedback: [
            {id:'feedback_note', label:'Feedback',  placeholder:'Quick observation or note for the teacher...'},
            {id:'tags',          label:'Tags',       placeholder:'e.g., culture, instruction, routines', type:'tags'},
        ]
    },

    // ---- EVALUATIONS (PMAPs) ----

    pmap_teacher: {
        id:'pmap_teacher_v1', name:'PMAP: Teacher', category:'evaluation',
        badge:'PMAP Teacher', badgeColor:'#dcfce7', badgeText:'#059669',
        scale:SCALE_1_5, colors:COLORS_1_5,
        hasCycles:false, hasRecording:false,
        preSections:  ['meeting_checklist', 'wig_goals', 'whirlwind'],
        dimensions:   TEACHER_DIMS,
        postSections: ['rubric_review_teacher', 'commitments', 'career', 'concerns'],
        feedback: [{id:'additional_comments', label:'Additional Comments', placeholder:'Any additional notes or context'}]
    },

    pmap_prek: {
        id:'pmap_prek_v1', name:'PMAP: PreK Teacher', category:'evaluation',
        badge:'PMAP PreK', badgeColor:'#dcfce7', badgeText:'#059669',
        scale:SCALE_1_7, colors:COLORS_1_7,
        hasCycles:true, hasRecording:false,
        preSections:  ['meeting_checklist', 'wig_goals', 'whirlwind'],
        dimensions:   PREK_DIMS,
        postSections: ['rubric_review_prek', 'commitments', 'career', 'concerns'],
        feedback: [{id:'additional_comments', label:'Additional Comments', placeholder:'Any additional notes or context'}]
    },

    pmap_support: {
        id:'pmap_support_v1', name:'PMAP: Non-Instructional Staff (Schools)', category:'evaluation',
        badge:'PMAP Support', badgeColor:'#dcfce7', badgeText:'#059669',
        scale:null, colors:null,
        hasCycles:false, hasRecording:false,
        preSections:  ['meeting_checklist', 'wig_goals', 'whirlwind', 'commitments', 'career', 'concerns'],
        dimensions:   [],
        feedback: []
    },

    pmap_leader: {
        id:'pmap_leader_v1', name:'PMAP: Leader', category:'evaluation',
        badge:'PMAP Leader', badgeColor:'#dcfce7', badgeText:'#059669',
        scale:SCALE_1_5, colors:COLORS_1_5,
        hasCycles:false, hasRecording:false,
        preSections:  ['meeting_checklist', 'wig_goals', 'whirlwind'],
        dimensions:   LEADER_DIMS,
        postSections: ['personal_leadership', 'commitments', 'career', 'concerns'],
        feedback: [{id:'additional_comments', label:'Additional Comments', placeholder:'Any additional notes or context'}]
    },

    pmap_network: {
        id:'pmap_network_v1', name:'PMAP: Network Staff', category:'evaluation',
        badge:'PMAP Network', badgeColor:'#dcfce7', badgeText:'#059669',
        scale:null, colors:null,
        hasCycles:false, hasRecording:false,
        preSections:  ['meeting_checklist', 'wig_goals', 'whirlwind', 'personal_leadership', 'commitments', 'career', 'concerns'],
        dimensions:   [],
        feedback: []
    },

    // ---- SELF-REFLECTIONS ----

    self_reflection_teacher: {
        id:'sr_teacher_v1', name:'Self-Reflection: Teacher', category:'evaluation',
        badge:'Self-Reflection', badgeColor:'#ede9fe', badgeText:'#7c3aed',
        scale:SCALE_1_5, colors:COLORS_1_5,
        hasCycles:false, hasRecording:false,
        dimensions: TEACHER_DIMS,
        postSections: ['rubric_review_teacher', 'commitments', 'career'],
        feedback: []
    },

    self_reflection_prek: {
        id:'sr_prek_v1', name:'Self-Reflection: PreK Teacher', category:'evaluation',
        badge:'Self-Reflection', badgeColor:'#ede9fe', badgeText:'#7c3aed',
        scale:SCALE_1_7, colors:COLORS_1_7,
        hasCycles:true, hasRecording:false,
        dimensions: PREK_DIMS,
        postSections: ['rubric_review_prek', 'commitments', 'career'],
        feedback: []
    },

    self_reflection_leader: {
        id:'sr_leader_v1', name:'Self-Reflection: Leader', category:'evaluation',
        badge:'Self-Reflection', badgeColor:'#ede9fe', badgeText:'#7c3aed',
        scale:SCALE_1_5, colors:COLORS_1_5,
        hasCycles:false, hasRecording:false,
        dimensions: LEADER_DIMS,
        postSections: ['personal_leadership', 'commitments', 'career'],
        feedback: []
    },

    self_reflection_network: {
        id:'sr_network_v1', name:'Self-Reflection: Network Staff', category:'evaluation',
        badge:'Self-Reflection', badgeColor:'#ede9fe', badgeText:'#7c3aed',
        scale:null, colors:null,
        hasCycles:false, hasRecording:false,
        dimensions: [],
        preSections: ['personal_leadership', 'commitments', 'career'],
        feedback: []
    },

    self_reflection_support: {
        id:'sr_support_v1', name:'Self-Reflection: Non-Instructional Staff', category:'evaluation',
        badge:'Self-Reflection', badgeColor:'#ede9fe', badgeText:'#7c3aed',
        scale:null, colors:null,
        hasCycles:false, hasRecording:false,
        dimensions: [],
        preSections: ['commitments', 'career'],
        feedback: []
    },

    // ---- DISCIPLINE ----

    iap: {
        id:'iap_v1', name:'Individualized Assistance Plan (IAP)', category:'discipline',
        badge:'IAP', badgeColor:'#fee2e2', badgeText:'#dc2626',
        scale:null, colors:null,
        hasCycles:false, hasRecording:false,
        dimensions: [],
        feedback: [
            {id:'reason',             label:'Reason for IAP',                        placeholder:'Describe the performance or behavioral concern...'},
            {id:'description',        label:'Description',                           placeholder:'Provide detailed context...'},
            {id:'action_plan',        label:'Action Plan',                           placeholder:'Steps the employee must take to improve...'},
            {id:'success_indicators', label:'Non-Negotiable Indicators of Success',  placeholder:'What must be demonstrated...'},
            {id:'timeline',           label:'Timeline',                              placeholder:'Timeframe for improvement...', type:'text'},
        ]
    },

    write_up: {
        id:'write_up_v1', name:'Employee Write-Up', category:'discipline',
        badge:'Write-Up', badgeColor:'#fee2e2', badgeText:'#dc2626',
        scale:null, colors:null,
        hasCycles:false, hasRecording:false,
        dimensions: [],
        feedback: [
            {id:'incident_date',    label:'Date of Incident',               type:'date'},
            {id:'description',      label:'Description of Issue',           placeholder:'Describe the incident or behavior...'},
            {id:'prior_discussion', label:'Prior Discussions',              placeholder:'Any prior conversations about this issue...'},
            {id:'expectations',     label:'Expectations Going Forward',     placeholder:'What is expected of the employee...'},
            {id:'consequences',     label:'Consequences if Not Corrected',  placeholder:'Next steps if behavior continues...'},
        ]
    },
};

// =============================================
// SMART FORM DETECTION
// =============================================
function detectFormType(staff) {
    const jf = (staff.job_function || '').toLowerCase();
    const jt = (staff.job_title || '').toLowerCase();

    if (jt.includes('prek') || jt.includes('pre-k') || jt.includes('pk'))
        return {type:'prek', badge:'CLASS', style:'background:#fce7f3;color:#db2777'};
    if (jf === 'leadership' || jt.includes('principal') || jt.includes('dean') || jt.includes('director'))
        return {type:'teacher', badge:'L1-L5', style:'background:#dcfce7;color:#059669'};  // Default obs form, PMAP auto-detects
    if (jf === 'network')
        return {type:'teacher', badge:'Network', style:'background:#e0e7ff;color:#4338ca'};
    if (jf === 'support' || jf === 'operations')
        return {type:'teacher', badge:'Support', style:'background:#f0fdf4;color:#16a34a'};
    return {type:'teacher', badge:'T1-T5', style:'background:#dbeafe;color:#2563eb'};
}

// Backward compat
var RUBRICS = FORMS;
