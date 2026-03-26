
const supporttickets = [
    {
        id: 1,
        imgBg: 'success',
        img: 'bi bi-ticket',
        iconColor: 'success',
        icon: 'ri-arrow-right-up-line',
        num: '3.47',
        count: 249,
        label: 'k',
        title: 'Total Tickets'
    },
    {
        id: 2,
        imgBg: 'warning',
        img: 'bi bi-hourglass-split',
        iconColor: 'danger',
        icon: 'ri-arrow-right-down-line',
        num: '6.33',
        count: 3174,
        title: 'Pending Tickets'
    }, {
        id: 3,
        imgBg: 'danger',
        img: 'bi bi-lock',
        iconColor: 'success',
        icon: 'ri-arrow-right-up-line',
        num: '7.34',
        count: 1596,
        title: 'Closed Tickets'
    }, {
        id: 4,
        imgBg: 'info',
        img: 'bi bi-ticket-perforated',
        iconColor: 'danger',
        icon: 'ri-arrow-right-down-line',
        num: '1.29',
        count: 365,
        title: 'New Tickets'
    },
];

const assignesTickets = [
    {
        id: 1,
        assigneeImg: "assets/images/users/32/avatar-1.jpg",
        assigneeName: 'Stefanie Cartwright'
    },
    {
        id: 2,
        assigneeImg: "assets/images/users/32/avatar-2.jpg",
        assigneeName: 'Marisol Gaylord'
    },
    {
        id: 3,
        assigneeImg: "assets/images/users/32/avatar-3.jpg",
        assigneeName: 'Merlin Heaney'
    },
    {
        id: 4,
        assigneeImg: "assets/images/users/32/avatar-4.jpg",
        assigneeName: 'Alexys Collier'
    },
    {
        id: 5,
        assigneeImg: "assets/images/users/32/avatar-5.jpg",
        assigneeName: "Kyla O'Hara"
    },
    {
        id: 6,
        assigneeImg: "assets/images/users/32/avatar-6.jpg",
        assigneeName: 'Twila Stark'
    },
    {
        id: 7,
        assigneeImg: "assets/images/users/32/avatar-7.jpg",
        assigneeName: 'Bennett Rice'
    },
    {
        id: 8,
        assigneeImg: "assets/images/users/32/avatar-8.jpg",
        assigneeName: 'Dusty Hackett'
    },
    {
        id: 9,
        assigneeImg: "assets/images/users/32/avatar-9.jpg",
        assigneeName: 'Ines Stracke'
    },
    {
        id: 10,
        assigneeImg: "assets/images/users/32/avatar-10.jpg",
        assigneeName: 'Abner Wisozk'
    },
]


const ticketList = [
    {
        id: 1,
        assignedto: [
            {
                assigneeName: "Stefanie Cartwright",
                assigneeImg: "assets/images/users/32/avatar-1.jpg"
            }, {
                assigneeName: "Marisol Gaylord",
                assigneeImg: "assets/images/users/32/avatar-2.jpg"
            }
        ],
        ticketTitle: "Webstorm does not recognize tags",
        clientName: "Domenic Dach",
        createDate: "17 Jan, 2023",
        dueDate: "23 Jan, 2023",
        priority: "Low",
        status: "Pending"
    },
    {
        id: 2,
        assignedto: [
            {
                assigneeName: "Merlin Heaney",
                assigneeImg: "assets/images/users/32/avatar-3.jpg"
            }, {
                assigneeName: "Alexys Collier",
                assigneeImg: "assets/images/users/32/avatar-4.jpg"
            }, {
                assigneeName: "Kyla O'Hara",
                assigneeImg: "assets/images/users/32/avatar-5.jpg"
            }
        ],
        ticketTitle: "Form error style for input addonAfter slot",
        clientName: "Prezy Mark",
        createDate: "29 Jan, 2023",
        dueDate: "06 Feb, 2023",
        priority: "Medium",
        status: "Open"
    },
    {
        id: 3,
        assignedto: [
            {
                assigneeName: "Twila Stark",
                assigneeImg: "assets/images/users/32/avatar-6.jpg"
            }, {
                assigneeName: "Bennett Rice",
                assigneeImg: "assets/images/users/32/avatar-7.jpg"
            }, {
                assigneeName: "Dusty Hackett",
                assigneeImg: "assets/images/users/32/avatar-8.jpg"
            }, {
                assigneeName: "Stefanie Cartwright",
                assigneeImg: "assets/images/users/32/avatar-1.jpg"
            }
        ],
        ticketTitle: "Not following the ReactJS folder structure",
        clientName: "Nelson Schaden",
        createDate: "01 Feb, 2023",
        dueDate: "07 Feb, 2023",
        priority: "High",
        status: "Pending"
    },
    {
        id: 4,
        assignedto: [
            {
                assigneeName: "Marisol Gaylord",
                assigneeImg: "assets/images/users/32/avatar-2.jpg"
            }
        ],
        ticketTitle: "Error message when placing an orders?",
        clientName: "Deondre Huel",
        createDate: "13 Feb, 2023",
        dueDate: "19 Feb, 2023",
        priority: "Low",
        status: "New"
    },
    {
        id: 5,
        assignedto: [
            {
                assigneeName: "Ines Stracke",
                assigneeImg: "assets/images/users/32/avatar-9.jpg"
            }, {
                assigneeName: "Abner Wisozk",
                assigneeImg: "assets/images/users/32/avatar-10.jpg"
            }
        ],
        ticketTitle: "Forgetting to start a component name with a capital letter",
        clientName: "Sarai Schmidt",
        createDate: "20 Feb, 2023",
        dueDate: "26 Feb, 2023",
        priority: "Low",
        status: "Close"
    },
    {
        id: 6,
        assignedto: [
            {
                assigneeName: "Stefanie Cartwright",
                assigneeImg: "assets/images/users/32/avatar-1.jpg"
            }, {
                assigneeName: "Twila Stark",
                assigneeImg: "assets/images/users/32/avatar-6.jpg"
            }, {
                assigneeName: "Kyla O'Hara",
                assigneeImg: "assets/images/users/32/avatar-5.jpg"
            }, {
                assigneeName: "Alexys Collier",
                assigneeImg: "assets/images/users/32/avatar-4.jpg"
            }
        ],
        ticketTitle: "Sending props as strings (instead of numbers)",
        clientName: "Ophelia Steuber",
        createDate: "06 Apr, 2023",
        dueDate: "12 Apr, 2023",
        priority: "High",
        status: "Open"
    },
    {
        id: 7,
        assignedto: [
            {
                assigneeName: "Alexys Collier",
                assigneeImg: "assets/images/users/32/avatar-4.jpg"
            }, {
                assigneeName: "Twila Stark",
                assigneeImg: "assets/images/users/32/avatar-6.jpg"
            }
        ],
        ticketTitle: "Creating and using God components",
        clientName: "Nelson Schaden",
        createDate: "27 Feb, 2023",
        dueDate: "05 Mar, 2023",
        priority: "Medium",
        status: "Pending"
    },
    {
        id: 8,
        assignedto: [
            {
                assigneeName: "Alexys Collier",
                assigneeImg: "assets/images/users/32/avatar-4.jpg"
            }, {
                assigneeName: "Twila Stark",
                assigneeImg: "assets/images/users/32/avatar-6.jpg"
            }, {
                assigneeName: "Bennett Rice",
                assigneeImg: "assets/images/users/32/avatar-7.jpg"
            }
        ],
        ticketTitle: "Forgetting that setState is asynchronous",
        clientName: "Zachary Stokes",
        createDate: "16 Mar, 2023",
        dueDate: "05 Mar, 2023",
        priority: "Medium",
        status: "Close"
    },
    {
        id: 9,
        assignedto: [
            {
                assigneeName: "Alexys Collier",
                assigneeImg: "assets/images/users/32/avatar-4.jpg"
            }, {
                assigneeName: "Merlin Heaney",
                assigneeImg: "assets/images/users/32/avatar-3.jpg"
            }
        ],
        ticketTitle: "Modifying the state directly",
        clientName: "Lloyd Vanburen",
        createDate: "21 Mar, 2023",
        dueDate: "26 Mar, 2023",
        priority: "Low",
        status: "New"
    },
    {
        id: 10,
        assignedto: [
            {
                assigneeName: "Stefanie Cartwright",
                assigneeImg: "assets/images/users/32/avatar-1.jpg"
            }
        ],
        ticketTitle: "Not creating enough components",
        clientName: "Janet Guin",
        createDate: "28 Mar, 2023",
        dueDate: "06 Apr, 2023",
        priority: "High",
        status: "Open"
    },
    {
        id: 11,
        assignedto: [
            {
                assigneeName: "Alexys Collier",
                assigneeImg: "assets/images/users/32/avatar-4.jpg"
            }, {
                assigneeName: "Twila Stark",
                assigneeImg: "assets/images/users/32/avatar-6.jpg"
            }
        ],
        ticketTitle: "Creating and using God components",
        clientName: "Nelson Schaden",
        createDate: "27 Feb, 2023",
        dueDate: "05 Mar, 2023",
        priority: "Medium",
        status: "Pending"
    }
]
export { supporttickets, assignesTickets, ticketList };