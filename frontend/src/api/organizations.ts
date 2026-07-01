import { userApi } from './axios'
import type { Organization } from '../types'

export const organizationsApi = {
  getByType: (type: 'HOSPITAL' | 'DISTRIBUTOR' | 'VENDOR') =>
    userApi.get<Organization[]>(`/organizations/type/${type}`).then(r => r.data),
}
