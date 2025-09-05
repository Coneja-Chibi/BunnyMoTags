// Get the last 50 lines that are clean
        }
        
    } catch (error) {
        logSeq(`Failed to initialize: ${error.message}`);
    }
}

// Initialize when DOM is ready
$(document).ready(() => {
    initBunnyMoTags();
});