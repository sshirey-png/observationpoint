import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Observe from './pages/Observe'
import QuickFeedback from './pages/QuickFeedback'
import Celebrate from './pages/Celebrate'
import Fundamentals from './pages/Fundamentals'
import SolicitFeedback from './pages/SolicitFeedback'
import Meeting from './pages/Meeting'
import PMAP from './pages/PMAP'
import SelfReflection from './pages/SelfReflection'
import Team from './pages/Team'
import StaffProfile from './pages/StaffProfile'
import Insights from './pages/Insights'
import Network from './pages/Network'
import School from './pages/School'
import CelebrationDrilldown from './pages/CelebrationDrilldown'
import TouchpointHub from './pages/TouchpointHub'
import PIP from './pages/PIP'
import WriteUp from './pages/WriteUp'
import Acknowledge from './pages/Acknowledge'
import Goals from './pages/Goals'
import QuickMeeting from './pages/QuickMeeting'
import FeedbackButton from './components/FeedbackButton'

/**
 * App — the root component. React Router handles navigation.
 *
 * All routes under /app/* are React pages.
 * /api/* goes to Flask (handled by Vite proxy in dev, Flask in prod).
 * /prototypes/* still serves vanilla JS (handled by Flask).
 */
export default function App() {
  return (
    <BrowserRouter>
      <FeedbackButton />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/app" element={<Home />} />
        {/* TouchPoint forms */}
        <Route path="/app/observe" element={<Observe />} />
        <Route path="/app/feedback" element={<QuickFeedback />} />
        <Route path="/app/celebrate" element={<Celebrate />} />
        <Route path="/app/fundamentals" element={<Fundamentals />} />
        <Route path="/app/meeting" element={<Meeting />} />
        <Route path="/app/solicit" element={<SolicitFeedback />} />
        <Route path="/app/pmap" element={<PMAP />} />
        <Route path="/app/self-reflection" element={<SelfReflection />} />
        <Route path="/app/pip" element={<PIP />} />
        <Route path="/app/write-up" element={<WriteUp />} />
        <Route path="/app/goals" element={<Goals />} />
        <Route path="/app/quick-meeting" element={<QuickMeeting />} />
        {/* Public acknowledgment page — no auth */}
        <Route path="/acknowledge/:token" element={<Acknowledge />} />
        <Route path="/acknowledge" element={<Acknowledge />} />
        <Route path="/app/team" element={<Team />} />
        <Route path="/app/touchpoint" element={<TouchpointHub />} />
        <Route path="/app/staff/:email" element={<StaffProfile />} />
        <Route path="/app/insights" element={<Insights />} />
        <Route path="/app/network" element={<Network />} />
        <Route path="/app/network/school/:name" element={<School />} />
        <Route path="/app/network/celebration" element={<CelebrationDrilldown />} />
      </Routes>
    </BrowserRouter>
  )
}
