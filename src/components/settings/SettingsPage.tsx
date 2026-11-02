import AIConfigPanel from './AIConfigPanel'
import ProjectStorageWorkspacePanel from './ProjectStorageWorkspacePanel'
import type { Project } from '../../lib/types'
interface Props { project?: Project; onOpenDataManagement?: () => void }
export default function SettingsPage({ project, onOpenDataManagement }: Props) {
 return <div className="h-full overflow-auto p-6"><AIConfigPanel /><div className="mt-6"><ProjectStorageWorkspacePanel project={project} onOpenDataManagement={onOpenDataManagement}/></div></div>
}
export const RoutedSettingsPage = SettingsPage
