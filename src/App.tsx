import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import TeacherProfile from './pages/TeacherProfile'
import BrowseTeachers from './pages/BrowseTeachers'
import TeacherDetail from './pages/TeacherDetail'
import Bookings from './pages/Bookings'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />

        <Route
          path="profile"
          element={
            <ProtectedRoute role="teacher">
              <TeacherProfile />
            </ProtectedRoute>
          }
        />
        <Route
          path="teachers"
          element={
            <ProtectedRoute>
              <BrowseTeachers />
            </ProtectedRoute>
          }
        />
        <Route
          path="teachers/:id"
          element={
            <ProtectedRoute>
              <TeacherDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="bookings"
          element={
            <ProtectedRoute>
              <Bookings />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Landing />} />
      </Route>
    </Routes>
  )
}
