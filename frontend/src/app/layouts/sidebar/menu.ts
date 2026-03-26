import { MenuItem } from "./menu.model";

export const MENU: MenuItem[] = [
    {
        id: 0,
        label: 'الصفحة الرئيسية',
        icon: 'ph-house',
        link: '/',
    },
    {
        id: 1,
        label: 'استنساخ الصوت',
        isTitle: true
    },
    {
        id: 2,
        label: 'مكتبة المؤثرات الصوتية',
        icon: 'ph-file-audio',
        link: 'sound-effects',
    },
    {
        id: 3,
        label: 'الأهداف محل الاستنساخ',
        icon: 'ph-users-three',
        link: 'targets',
    },
]