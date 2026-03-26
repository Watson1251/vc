const chatData = [
    {
        id: 1,
        roomId: 1,
        name: "Lisa Parker",
        image: "assets/images/users/48/avatar-2.jpg",
    },
    {
        id: 2,
        roomId: 1,
        name: "Frank Thomas",
        image: "assets/images/users/48/avatar-3.jpg",
        messageCount: '8'
    },
    {
        id: 3,
        roomId: 1,
        name: "Clifford Taylor",
        isImg: true,
        profile: "CT"
    },
    {
        id: 4,
        roomId: 1,
        name: "Janette Caster",
        image: "assets/images/users/48/avatar-4.jpg",
    },
    {
        id: 5,
        roomId: 1,
        name: "Sarah Beattie",
        image: "assets/images/users/48/avatar-5.jpg",
        messageCount: '5'
    },
    {
        id: 6,
        roomId: 1,
        name: "Nellie Cornett",
        image: "assets/images/users/48/avatar-6.jpg",
        messageCount: '2'
    },
    {
        id: 7,
        roomId: 1,
        name: "Chris Kiernan",
        isImg: true,
        profile: "CK"
    },
    {
        id: 8,
        roomId: 1,
        name: "Edith Evans",
        isImg: true,
        profile: "EE"
    },
    {
        id: 9,
        roomId: 1,
        name: "Joseph Siegel",
        image: "assets/images/users/48/avatar-7.jpg",
    },
];

const ChannelsData = [
    {
        id: 1,
        name: 'Landing Design',
        messageCount: '7'
    },
    {
        id: 2,
        name: 'General'
    },
    {
        id: 3,
        name: 'Project Tasks',
        messageCount: '2'
    },
    {
        id: 4,
        name: 'Meeting'
    },
    {
        id: 5,
        name: 'Reporting'
    }
];

const chatContactData = [
    {
        title: 'A',
        contacts: [
            {
                id: 1,
                name: 'Alice Cruickshank',
                status: "offline",
                roomId: 5,
                isImg: true,
                profile: "AC"
            }
        ],
    },
    {
        title: 'B',
        contacts: [
            {
                id: 1,
                name: 'Barrett Brown',
                status: "offline",
                roomId: 1,
                image: "assets/images/users/48/avatar-4.jpg"
            }
        ],
    },
    {
        title: 'C',
        contacts: [
            {
                id: 1,
                name: 'Chris Kiernan',
                status: "offline",
                roomId: 3,
                isImg: true,
                profile: "CK"
            },
            {
                id: 2,
                name: 'Clifford Taylor',
                status: "offline",
                roomId: 4,
                isImg: true,
                profile: "CT"
            }
        ],
    },
    {
        title: 'E',
        contacts: [
            {
                id: 1,
                name: 'Edith Evans',
                status: "offline",
                roomId: 5,
                isImg: true,
                profile: "EE"
            }
        ],
    },
    {
        title: 'F',
        contacts: [
            {
                id: 1,
                name: 'Frank Thomas',
                status: "offline",
                roomId: 6,
                image: "assets/images/users/48/avatar-3.jpg"
            }
        ],
    },
    {
        title: 'G',
        contacts: [
            {
                id: 1,
                name: 'Gilbert Beer',
                status: "offline",
                roomId: 7,
                isImg: true,
                profile: "GB"
            }
        ],
    },
    {
        title: 'J',
        contacts: [
            {
                id: 1,
                name: 'Janette Caster',
                status: "offline",
                roomId: 8,
                image: "assets/images/users/48/avatar-4.jpg"
            },
            {
                id: 2,
                name: 'Joseph Siegel',
                status: "offline",
                roomId: 9,
                image: "assets/images/users/48/avatar-7.jpg"
            },
            {
                id: 3,
                name: 'Justyn Wisoky',
                status: "offline",
                roomId: 2,
                image: "assets/images/users/48/avatar-1.jpg"
            }
        ],
    },
    {
        title: 'K',
        contacts: [
            {
                id: 1,
                name: 'Keaton King',
                status: "offline",
                roomId: 11,
                image: "assets/images/users/48/avatar-5.jpg"
            }
        ],
    },
    {
        title: 'L',
        contacts: [
            {
                id: 1,
                name: 'Lisa Parker',
                status: "offline",
                roomId: 1,
                image: "assets/images/users/48/avatar-2.jpg"
            }
        ],
    },
    {
        title: 'M',
        contacts: [
            {
                id: 1,
                name: 'Marian Moen',
                status: "offline",
                roomId: 3,
                isImg: true,
                profile: "MM"
            }
        ],
    },
    {
        title: 'N',
        contacts: [
            {
                id: 1,
                name: 'Nellie Cornett',
                status: "offline",
                roomId: 4,
                image: "assets/images/users/48/avatar-6.jpg",
                isImg: true,
                profile: "NC"
            }
        ],
    },
    {
        title: 'R',
        contacts: [
            {
                id: 1,
                name: 'Ronald Downey',
                status: "offline",
                roomId: 5,
                isImg: true,
                profile: "RD"
            }
        ],
    },
    {
        title: 'S',
        contacts: [
            {
                id: 1,
                name: 'Sarah Beattie',
                status: "offline",
                roomId: 6,
                image: "assets/images/users/48/avatar-5.jpg"
            }
        ],
    },
    {
        title: 'V',
        contacts: [
            {
                id: 1,
                name: 'Victor Beahan',
                status: "offline",
                roomId: 7,
                image: "assets/images/users/48/avatar-10.jpg"
            }
        ],
    },
    {
        title: 'W',
        contacts: [
            {
                id: 1,
                name: 'Wayne Runte',
                status: "offline",
                roomId: 8,
                image: "assets/images/users/48/avatar-2.jpg"
            }
        ],
    },
];


const messages = [
    {
        id: 1,
        roomId: 1,
        sender: "Lisa Parker",
        message: "Good morning 😊",
        createdAt: "09:07 am",
        isSender: false,
    },
    {
        id: 2,
        roomId: 1,
        sender: "Anna Adame",
        message: "Good morning, How are you? What about our next meeting?",
        createdAt: "09:08 am",
        isSender: true,
    },
    {
        id: 3,
        roomId: 1,
        sender: "Lisa Parker",
        message: "Yeah everything is fine. Our next meeting tomorrow at 10.00 AM",
        isSender: false,
    },
    {
        id: 4,
        roomId: 1,
        sender: "Lisa Parker",
        message: "Hey, I'm going to meet a friend of mine at the department store. I have to buy some presents for my parents 🎁.",
        createdAt: "09:10 am",
        isSender: false,
    },
    {
        id: 5,
        roomId: 1,
        sender: "Anna Adame",
        message: "Wow that's great",
        createdAt: "09:12 am",
        isSender: true,
    },
];

export { messages, chatContactData, chatData, ChannelsData };