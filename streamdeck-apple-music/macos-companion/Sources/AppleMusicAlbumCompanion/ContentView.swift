import SwiftUI

struct ContentView: View {
    @ObservedObject var model: CompanionViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Apple Music Album")
                .font(.system(size: 24, weight: .semibold))

            VStack(alignment: .leading, spacing: 8) {
                Text("Album URL")
                    .font(.headline)

                TextField("https://music.apple.com/...", text: $model.albumURL)
                    .textFieldStyle(.roundedBorder)

                Button("Assign to Armed Key") {
                    model.assign()
                }
                .buttonStyle(.borderedProminent)
            }

            Divider()

            HStack {
                Text("Plugin")
                    .fontWeight(.medium)
                Spacer()
                Text(model.pluginStatus)
                    .foregroundStyle(model.pluginStatus == "Connected" ? .green : .orange)
            }

            HStack {
                Text("Armed Key")
                    .fontWeight(.medium)
                Spacer()
                Text(model.armedKeyLabel)
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(.secondary)
            }

            Text(model.statusMessage)
                .font(.callout)
                .foregroundStyle(color(for: model.statusTone))
                .frame(maxWidth: .infinity, alignment: .leading)

            Spacer()
        }
        .padding(20)
        .frame(width: 460, height: 300)
    }

    private func color(for tone: StatusTone) -> Color {
        switch tone {
        case .error:
            return .red
        case .info:
            return .secondary
        case .success:
            return .green
        case .warning:
            return .orange
        }
    }
}
